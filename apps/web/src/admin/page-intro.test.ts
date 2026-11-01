import { createI18n, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { MAX_EXPLAINED_LENGTH } from "@/back-office-assistant/conversation";
import { explainedSchema } from "@/back-office-assistant/explained";
import { INTRO_PAGES, pageIntro, type IntroPage } from "./page-intro";

/** What each page interpolates into its explanation, as the pages give it. */
const VALUES: Record<IntroPage, Record<string, string>> = {
  platformSettings: {},
  dashboard: { roles: "super-admin, Technique, Support" },
  discoveryRuns: { days: "30", months: "13" },
  receivedEmails: { months: "13" },
  aiMessages: { days: "30" },
  audit: { years: "5" },
  signalements: {},
  plans: {},
  planQuotas: {},
  coupons: {},
  humanCoaches: {},
  coachCost: { days: "30", target: "0,0200 €" },
  coachingPlaybooks: {},
  guardrails: {},
  unansweredQuestions: {},
  tools: {},
  administrators: {},
  aiUsage: {},
  withdrawals: {},
};

describe("a Back Office page's intro in the Compact Density (#465, #466)", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const { t } = createI18n(locale);

    for (const page of INTRO_PAGES) {
      it(`${page} (${locale}): one short sentence under the title, the rest behind « En savoir plus »`, () => {
        const intro = pageIntro(t, page, VALUES[page]);
        // One muted line at 1440 px: one sentence, and short enough not to wrap beside the Sidebar.
        expect(intro.line).not.toBe("");
        expect(intro.line.length).toBeLessThanOrEqual(90);
        expect(intro.line.match(/[.!?…](\s|$)/g) ?? []).toHaveLength(1);
        expect(intro.more).toBe(t("admin.pageIntro.more"));
        // The explanation keeps every value the page gives it…
        for (const value of Object.values(VALUES[page])) expect(intro.explanation).toContain(value);
        // …and the Back Office Assistant takes it as an Explainable label's context: never longer than it accepts.
        expect(intro.explanation.length).toBeLessThanOrEqual(MAX_EXPLAINED_LENGTH);
        expect(explainedSchema.safeParse({ label: intro.line, page: "/admin", kind: "intro", id: page, state: intro.explanation }).success).toBe(true);
      });
    }
  }

  it("Paramètres' explanation says what the long intro said: the order of the sources and how a change applies", () => {
    const { t } = createI18n("fr");
    const { explanation } = pageIntro(t, "platformSettings", {});
    expect(explanation).toContain(t("admin.platformSettings.intro"));
    expect(explanation).toContain(t("admin.platformSettings.editIntro"));
  });

  it("the Dashboard's explanation names the Administrator's roles", () => {
    const { t } = createI18n("fr");
    expect(pageIntro(t, "dashboard", { roles: "Support" }).explanation).toContain(t("admin.yourRoles", { roles: "Support" }));
  });

  it("every other section's explanation keeps what its long intro said (#466)", () => {
    const { t } = createI18n("fr");
    expect(pageIntro(t, "signalements", {}).explanation).toContain(t("admin.signalements.noDeletion"));
    expect(pageIntro(t, "unansweredQuestions", {}).explanation).toContain(t("admin.unansweredQuestions.privacy"));
    expect(pageIntro(t, "coachCost", { days: "30", target: "0,0200 €" }).explanation).toContain(t("admin.coachCost.intro", { days: "30", target: "0,0200 €" }));
    expect(pageIntro(t, "guardrails", {}).explanation).toContain(t("admin.guardrails.intro"));
  });
});
