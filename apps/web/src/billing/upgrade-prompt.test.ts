import { describe, expect, it } from "vitest";
import { quotaExceededResponse, upgradePrompt } from "./upgrade-prompt";

const FREE = { fr: "Gratuite", en: "Free" };
const STANDARD = { fr: "Standard", en: "Standard" };
const PREMIUM = { fr: "Premium", en: "Premium" };

describe("upgrade prompts", () => {
  it("tells a Free Candidate they used this week's Match Scores and which Plan gives more", () => {
    const prompt = upgradePrompt({ allowed: false, quota: "matchScores", plan: "free", planName: FREE, limit: 3, upgradeTo: "standard", upgradeToName: STANDARD }, "fr");

    expect(prompt).toEqual({
      title: "Vous avez atteint la limite de votre offre",
      message:
        "Vous avez utilisé les 3 Match Scores compris cette semaine dans l'offre Gratuite. Avec l'offre Standard, vous pouvez en faire davantage.",
      upgradeTo: "standard",
      action: "Découvrir l'offre Standard",
      href: "/abonnement",
    });
  });

  it("names the Plans as Administrators named them, in the Candidate's language", () => {
    const essential = { fr: "Essentiel", en: "Essential" };
    const decision = { allowed: false, quota: "matchScores", plan: "free", planName: { fr: "Découverte", en: "Discovery" }, limit: 3, upgradeTo: "essentiel", upgradeToName: essential } as const;

    expect(upgradePrompt(decision, "en")).toMatchObject({
      message: "You have used the 3 Match Scores included this week in the Discovery Plan. The Essential Plan lets you do more.",
      action: "See the Essential Plan",
    });
  });

  it("speaks of a single Profile in the singular", () => {
    expect(upgradePrompt({ allowed: false, quota: "profiles", plan: "free", planName: FREE, limit: 1, upgradeTo: "standard", upgradeToName: STANDARD }, "fr").message).toBe(
      "L'offre Gratuite comprend 1 profil. Avec l'offre Standard, vous pouvez en créer davantage.",
    );
  });

  it("explains a quota the Plan does not include at all", () => {
    expect(upgradePrompt({ allowed: false, quota: "enrichedContacts", plan: "standard", planName: STANDARD, limit: 0, upgradeTo: "premium", upgradeToName: PREMIUM }, "en").message).toBe(
      "Enriched Contacts are not included in the Standard Plan. The Premium Plan includes them.",
    );
  });

  it("explains that the Plan does not include the Job Digest, and which Plan does", () => {
    expect(upgradePrompt({ quota: "jobDigest", plan: "free", planName: FREE, limit: 0, upgradeTo: "standard", upgradeToName: STANDARD }, "fr").message).toBe(
      "La réception du Job Digest n'est pas comprise dans l'offre Gratuite. L'offre Standard la comprend.",
    );
  });

  it("explains that the Plan sends the Job Digest less often than daily, and which Plan sends it daily", () => {
    expect(upgradePrompt({ quota: "jobDigest", plan: "standard", planName: STANDARD, limit: 0, upgradeTo: "premium", upgradeToName: PREMIUM, frequency: "daily" }, "fr").message).toBe(
      "Le Job Digest quotidien n'est pas compris dans l'offre Standard. L'offre Premium le comprend.",
    );
    expect(upgradePrompt({ quota: "jobDigest", plan: "standard", planName: STANDARD, limit: 0, upgradeTo: "premium", upgradeToName: PREMIUM, frequency: "daily" }, "en").message).toBe(
      "The daily Job Digest is not included in the Standard Plan. The Premium Plan includes it.",
    );
  });

  it("tells a Candidate on the top Plan when the quota comes back, with nothing to buy", () => {
    const prompt = upgradePrompt({ allowed: false, quota: "enrichedContacts", plan: "premium", planName: PREMIUM, limit: 20, upgradeTo: null, upgradeToName: null }, "fr");

    expect(prompt.message).toBe(
      "Vous avez utilisé les 20 contacts enrichis compris cette semaine dans l'offre Premium. Votre quota se renouvelle chaque lundi.",
    );
    expect(prompt.action).toBeNull();
  });

  it("answers an API call over quota with 402 Payment Required and the prompt to show", async () => {
    const response = quotaExceededResponse({ allowed: false, quota: "atsScores", plan: "free", planName: FREE, limit: 1, upgradeTo: "standard", upgradeToName: STANDARD }, "en");

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "quota_exceeded",
      quota: "atsScores",
      plan: "free",
      limit: 1,
      upgradeTo: "standard",
      prompt: {
        title: "You have reached your Plan's limit",
        message: "You have used the 1 ATS Score included this week in the Free Plan. The Standard Plan lets you do more.",
        upgradeTo: "standard",
        action: "See the Standard Plan",
        href: "/abonnement",
      },
    });
  });
});
