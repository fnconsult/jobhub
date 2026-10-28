import { describe, expect, it } from "vitest";
import { gmailConfirmationOf } from "./gmail-confirmation";

// Fictional texts on the model Google's help describes (docs/research/issue-451.md): no Google document gives the code's
// length or characters, so any run of digits after « code » counts, and the confirmation link is always kept as a fallback.
const FRENCH = [
  "marie.dupont@gmail.com a demandé à transférer automatiquement ses e-mails vers votre adresse k3v7q2abcdefghij@alertes.jobbbox.ai.",
  "Code de confirmation : 123456789",
  "Pour autoriser marie.dupont@gmail.com à transférer automatiquement des e-mails vers votre adresse, cliquez sur le lien ci-dessous pour confirmer la demande :",
  "https://mail-settings.google.com/mail/vf-%5BANGjdJ8fixture%5D-abcdef",
].join("\n");

describe("Gmail's forwarding confirmation, as the setup wizard shows it", () => {
  it("finds the confirmation code and the link in a French confirmation", () => {
    expect(gmailConfirmationOf(FRENCH)).toEqual({ code: "123456789", link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ8fixture%5D-abcdef" });
  });

  it("finds them in an English one whose link the HTML part wrote after its words", () => {
    const text = "Confirmation code: 50213\nTo allow it, please click the link below: Confirm <https://mail.google.com/mail/vf-fixture-42>";

    expect(gmailConfirmationOf(text)).toEqual({ code: "50213", link: "https://mail.google.com/mail/vf-fixture-42" });
  });

  it("keeps only a link on Google's own hosts, and the link alone when no code reads", () => {
    const text = "Click https://phishing.example.test/mail/vf-1 or https://mail-settings.google.com/mail/vf-2 to confirm.";

    expect(gmailConfirmationOf(text)).toEqual({ code: null, link: "https://mail-settings.google.com/mail/vf-2" });
  });

  it("takes the subject's number when the text has no code (« (#123456) Gmail Forwarding Confirmation »)", () => {
    expect(gmailConfirmationOf("(#987654) Gmail Forwarding Confirmation - Receive Mail from marie.dupont@gmail.com")).toEqual({ code: "987654", link: null });
  });

  it("finds nothing in a text that holds neither", () => {
    expect(gmailConfirmationOf("Bonjour")).toEqual({ code: null, link: null });
  });
});
