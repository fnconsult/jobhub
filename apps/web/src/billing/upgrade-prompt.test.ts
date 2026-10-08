import { describe, expect, it } from "vitest";
import { quotaExceededResponse, upgradePrompt } from "./upgrade-prompt";

describe("upgrade prompts", () => {
  it("tells a Free Candidate they used this month's Match Scores and which Plan gives more", () => {
    const prompt = upgradePrompt({ allowed: false, quota: "matchScores", plan: "free", limit: 3, upgradeTo: "standard" }, "fr");

    expect(prompt).toEqual({
      title: "Vous avez atteint la limite de votre offre",
      message:
        "Vous avez utilisé les 3 Match Scores compris ce mois-ci dans l'offre Gratuite. Avec l'offre Standard, vous pouvez en faire davantage.",
      upgradeTo: "standard",
      action: "Découvrir l'offre Standard",
      href: "/abonnement",
    });
  });

  it("speaks of a single Profile in the singular", () => {
    expect(upgradePrompt({ allowed: false, quota: "profiles", plan: "free", limit: 1, upgradeTo: "standard" }, "fr").message).toBe(
      "L'offre Gratuite comprend 1 profil. Avec l'offre Standard, vous pouvez en créer davantage.",
    );
  });

  it("explains a quota the Plan does not include at all", () => {
    expect(upgradePrompt({ allowed: false, quota: "enrichedContacts", plan: "standard", limit: 0, upgradeTo: "premium" }, "en").message).toBe(
      "Enriched Contacts are not included in the Standard Plan. The Premium Plan includes them.",
    );
  });

  it("tells a Candidate on the top Plan when the quota comes back, with nothing to buy", () => {
    const prompt = upgradePrompt({ allowed: false, quota: "enrichedContacts", plan: "premium", limit: 20, upgradeTo: null }, "fr");

    expect(prompt.message).toBe(
      "Vous avez utilisé les 20 contacts enrichis compris ce mois-ci dans l'offre Premium. Votre quota se renouvelle le 1er du mois.",
    );
    expect(prompt.action).toBeNull();
  });

  it("answers an API call over quota with 402 Payment Required and the prompt to show", async () => {
    const response = quotaExceededResponse({ allowed: false, quota: "atsScores", plan: "free", limit: 1, upgradeTo: "standard" }, "en");

    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "quota_exceeded",
      quota: "atsScores",
      plan: "free",
      limit: 1,
      upgradeTo: "standard",
      prompt: {
        title: "You have reached your Plan's limit",
        message: "You have used the 1 ATS Score included this month in the Free Plan. The Standard Plan lets you do more.",
        upgradeTo: "standard",
        action: "See the Standard Plan",
        href: "/abonnement",
      },
    });
  });
});
