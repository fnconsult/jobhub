import { resources, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { STARTING_PLAN_QUOTAS } from "./index";
import { upgradePrompt } from "./upgrade-prompt";
import { usageMeter } from "./usage-meter";

/** A token count, in either language: AI Activity's technical measure (#320), never a Plan Quota. */
const TOKENS = /tokens?|jetons?/i;

function texts(tree: unknown): string[] {
  if (typeof tree === "string") return [tree];
  return tree && typeof tree === "object" ? Object.values(tree).flatMap(texts) : [];
}

describe("Plan Quotas never count tokens (#332, CONTEXT.md « AI Activity »)", () => {
  it("say no token count in the Usage Meter, on /abonnement or in an Upgrade Prompt, in any language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { usageMeter: meter, billing } = resources[locale].translation;

      expect(texts(meter).filter((text) => TOKENS.test(text))).toEqual([]);
      expect(texts(billing).filter((text) => TOKENS.test(text))).toEqual([]);
    }
  });

  it("measure the week in uses of each quota, never in tokens", () => {
    const meter = usageMeter(STARTING_PLAN_QUOTAS.free, { matchScores: 2, atsScores: 0, enrichedContacts: 0, jobSearches: 1 });
    const prompt = upgradePrompt(
      { allowed: false, quota: "matchScores", plan: "free", planName: { fr: "Gratuite", en: "Free" }, limit: 3, upgradeTo: "standard", upgradeToName: { fr: "Standard", en: "Standard" } },
      "fr",
    );

    expect(JSON.stringify(meter)).not.toMatch(TOKENS);
    expect(JSON.stringify(prompt)).not.toMatch(TOKENS);
  });
});
