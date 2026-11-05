import type { LegalTextVersion } from "@jobhub/help";
import { legalStepsResponseSchema } from "@jobhub/shared/reads";
import { describe, expect, it } from "vitest";
import { legalSteps } from "./legal-steps";

/** A Legal Text Version as the repo writes it, in `locale`. */
function written(text: LegalTextVersion["text"], effective: string, locale: "fr" | "en", change: LegalTextVersion["change"] = "substantielle"): LegalTextVersion {
  const title = locale === "fr" ? "Conditions générales d'utilisation" : "Terms of use";
  return {
    text,
    locale,
    effective,
    title: text === "cgu" ? title : locale === "fr" ? "Politique de confidentialité" : "Privacy policy",
    change,
    approvedBy: "François",
    summary: "Première version",
    inBrief: [locale === "fr" ? "Écrivez à {{contact-email}}." : "Write to {{contact-email}}."],
    sections: [{ id: "objet", number: 1, title: locale === "fr" ? "Objet" : "Purpose", body: locale === "fr" ? "Jobbbox **aide** à chercher un emploi.\n\n- un point" : "Jobbbox **helps** you look for a job." }],
  };
}

const WRITTEN = { fr: [written("cgu", "2026-12-01", "fr"), written("confidentialite", "2026-12-01", "fr")], en: [written("cgu", "2026-12-01", "en"), written("confidentialite", "2026-12-01", "en")] };
const ON = "2026-12-02";

describe("the legal steps the Jobbbox app asks after sign-in (#689)", () => {
  it("shows the CGU version to accept with the repo's own Markdown, the contact address filled in", () => {
    const steps = legalSteps({ cgu: { version: "2026-12-01" }, privacyChange: null, euAiConsentGiven: false }, "fr", { on: ON, written: WRITTEN, contactEmail: "bonjour@jobbbox.ai" });

    expect(legalStepsResponseSchema.parse(steps)).toEqual({
      acceptance: {
        version: "2026-12-01",
        url: "/legal/cgu/2026-12-01",
        title: "Conditions générales d'utilisation",
        translation: false,
        inBrief: ["Écrivez à bonjour@jobbbox.ai."],
        sections: [{ title: "1. Objet", body: "Jobbbox **aide** à chercher un emploi.\n\n- un point" }],
      },
      privacyChange: null,
      euAiConsentGiven: false,
    });
  });

  it("shows the English translation, marked as one, with the privacy policy's change and the EU AI Consent given", () => {
    const steps = legalSteps({ cgu: null, privacyChange: { version: "2026-12-01" }, euAiConsentGiven: true }, "en", { on: ON, written: WRITTEN, contactEmail: "" });

    expect(steps.acceptance).toBeNull();
    expect(steps.privacyChange).toMatchObject({ version: "2026-12-01", url: "/legal/confidentialite/2026-12-01", title: "Privacy policy", translation: true });
    expect(steps.privacyChange?.sections).toEqual([{ title: "1. Purpose", body: "Jobbbox **helps** you look for a job." }]);
    expect(steps.euAiConsentGiven).toBe(true);
  });

  it("asks nothing it cannot show: a version the build does not carry in that language is left out", () => {
    const steps = legalSteps({ cgu: { version: "2027-01-01" }, privacyChange: null, euAiConsentGiven: true }, "fr", { on: ON, written: WRITTEN, contactEmail: "" });

    expect(steps.acceptance).toBeNull();
  });
});
