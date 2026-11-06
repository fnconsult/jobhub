import { resources, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { consumptionPeriod, consumptionSection } from "../consumption/section";
import { STARTING_PLAN_QUOTAS } from "./index";
import { upgradePrompt } from "./upgrade-prompt";
import { usageMeter } from "./usage-meter";

/** A token count, in either language: AI Activity's technical measure (#320), never a Plan Quota. */
const TOKENS = /tokens?|jetons?/i;
/** An amount in euros (« 9,90 € », « 19 EUR », « 12 euros »): never on « Votre consommation » (ADR-0091). */
const EURO_AMOUNT = /\d[\d\s.,\u00a0\u202f]*\s?(?:€|eur\b|euros?)|€\s?\d/i;
/**
 * The one line that names jetons, to say they are not used: « Votre consommation »'s foot (ADR-0091), « Compté en
 * utilisations, jamais en jetons ni en euros. »
 */
const NEVER_IN_TOKENS = /^(?:Compté en utilisations, jamais en jetons ni en euros\.|Counted in uses, never in tokens or euros\.)$/;

function texts(tree: unknown): string[] {
  if (typeof tree === "string") return [tree];
  return tree && typeof tree === "object" ? Object.values(tree).flatMap(texts) : [];
}

describe("Plan Quotas never count tokens (#332, CONTEXT.md « AI Activity »)", () => {
  it("say no token count in the Usage Meter, on /abonnement or in an Upgrade Prompt, in any language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { usageMeter: meter, billing } = resources[locale].translation;

      expect(texts(meter).filter((text) => TOKENS.test(text))).toEqual([]);
      expect(texts(billing).filter((text) => TOKENS.test(text) && !NEVER_IN_TOKENS.test(text))).toEqual([]);
    }
  });

  it("say no token count and no amount in euros on « Votre consommation » (#801), whose foot alone says it counts neither", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const { consumption } = resources[locale].translation.billing;
      const mentions = texts(consumption).filter((text) => TOKENS.test(text));

      expect(mentions).toEqual([consumption.footUnits]);
      expect(consumption.footUnits).toMatch(NEVER_IN_TOKENS);
      expect(texts(consumption).filter((text) => EURO_AMOUNT.test(text))).toEqual([]);
    }
  });

  it("serialize « Votre consommation » without a token count or an amount in euros, in French and English (#801)", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const period = consumptionPeriod({ kind: "billed", start: new Date("2026-10-18T08:00:00Z"), end: new Date("2026-11-18T08:00:00Z"), renewedBefore: true }, now);
    const days = [
      { day: "2026-10-20", tool: "coach", count: 12 },
      { day: "2026-11-02", tool: "matchScore", count: 3 },
      { day: "2026-11-05", tool: "enrichedContact", count: 1 },
    ] as const;
    for (const locale of SUPPORTED_LOCALES) {
      const props = JSON.stringify(consumptionSection({ period, days: [...days], now, quotas: STARTING_PLAN_QUOTAS.standard, usedThisWeek: { matchScores: 3, atsScores: 0, enrichedContacts: 1, jobSearches: 0 }, locale }));

      expect(props).not.toMatch(TOKENS);
      expect(props).not.toMatch(EURO_AMOUNT);
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
