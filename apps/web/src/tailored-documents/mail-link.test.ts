import { describe, expect, it } from "vitest";
import { mailLink } from "./mail-link";

describe("opening an Outreach Message in the Candidate's own mail client", () => {
  it("is a mailto link with no recipient, carrying the subject and the text, line breaks kept", () => {
    expect(mailLink({ subject: "Candidature DAF & contrôle", text: "Bonjour,\n\nJe vous écris." })).toBe(
      "mailto:?subject=Candidature%20DAF%20%26%20contr%C3%B4le&body=Bonjour%2C%0D%0A%0D%0AJe%20vous%20%C3%A9cris.",
    );
  });

  it("leaves the subject out when there is none", () => {
    expect(mailLink({ subject: "", text: "Bonjour" })).toBe("mailto:?body=Bonjour");
  });

  it("is addressed to the Enriched Contact's email when the message is for one", () => {
    expect(mailLink({ to: "claire.martin@acme-industrie.fr", subject: "", text: "Bonjour" })).toBe("mailto:claire.martin@acme-industrie.fr?body=Bonjour");
  });
});
