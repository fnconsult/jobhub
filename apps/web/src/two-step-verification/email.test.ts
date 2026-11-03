import { describe, expect, it } from "vitest";
import { twoStepChangeEmail } from "./email";

const at = new Date("2026-11-02T09:30:00Z");
const securityUrl = "https://app.jobbbox.fr/compte/securite";

describe("the email telling the account its Two-step verification changed", () => {
  it("says it was turned on, in French, with the date and a link to Sécurité", () => {
    const email = twoStepChangeEmail({ change: "enabled", at, securityUrl }, "fr");

    expect(email.subject).toBe("Vérification en deux étapes activée");
    expect(email.text).toContain("activée sur votre compte Jobbbox le 2 novembre 2026");
    expect(email.text).toContain(securityUrl);
  });

  it("says it was turned off, in English", () => {
    const email = twoStepChangeEmail({ change: "disabled", at, securityUrl }, "en");

    expect(email.subject).toBe("Two-step verification turned off");
    expect(email.text).toContain("turned off for your Jobbbox account on November 2, 2026");
  });

  it("says a super-admin reset it, its factors and sessions gone, to set it up again (#665)", () => {
    const email = twoStepChangeEmail({ change: "reset", at, securityUrl }, "fr");

    expect(email.subject).toBe("Vérification en deux étapes réinitialisée");
    expect(email.text).toContain("Un super-admin de Jobbbox a réinitialisé la vérification en deux étapes de votre compte le 2 novembre 2026");
    expect(email.text).toContain("vous la configurerez de nouveau");
    expect(twoStepChangeEmail({ change: "reset", at, securityUrl }, "en").subject).toBe("Two-step verification reset");
  });
});
