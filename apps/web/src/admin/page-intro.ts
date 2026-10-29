/**
 * A Back Office page's intro in the Compact Density (#465, ADR-0053): one muted line under the page's title; what the
 * longer intro said moves behind an Explainable label, « En savoir plus », which asks the Back Office Assistant to
 * explain the page with that text as its context. `pageIntro` says, for each page, its line and that explanation.
 */
import type { TFunction, TOptions } from "i18next";

/** The pages whose intro is cut to one line: the pilot pages of the Compact Density, Activité's tabs (#465), and every other section (#466). */
export const INTRO_PAGES = [
  "platformSettings",
  "dashboard",
  "discoveryRuns",
  "receivedEmails",
  "aiMessages",
  "audit",
  "signalements",
  "plans",
  "planQuotas",
  "coupons",
  "humanCoaches",
  "coachCost",
  "coachingPlaybooks",
  "guardrails",
  "unansweredQuestions",
  "tools",
  "administrators",
  "aiUsage",
] as const;
export type IntroPage = (typeof INTRO_PAGES)[number];

export interface PageIntroText {
  /** The one line under the title. */
  line: string;
  /** The Explainable label's words. */
  more: string;
  /** What the Back Office Assistant is told of the page when asked: the former intro, in full. */
  explanation: string;
}

/** Each page's line, then the texts its explanation is made of, in order. */
const TEXTS = {
  platformSettings: { line: "admin.platformSettings.subtitle", explanation: ["admin.platformSettings.intro", "admin.platformSettings.editIntro"] },
  dashboard: { line: "admin.dashboard.subtitle", explanation: ["admin.dashboard.intro", "admin.yourRoles"] },
  discoveryRuns: { line: "admin.discoveryRuns.subtitle", explanation: ["admin.discoveryRuns.intro"] },
  receivedEmails: { line: "admin.receivedEmails.subtitle", explanation: ["admin.receivedEmails.intro"] },
  aiMessages: { line: "admin.aiMessages.subtitle", explanation: ["admin.aiMessages.intro"] },
  audit: { line: "admin.journal.subtitle", explanation: ["admin.journal.intro"] },
  signalements: { line: "admin.signalements.subtitle", explanation: ["admin.signalements.intro", "admin.signalements.noDeletion"] },
  plans: { line: "admin.plans.subtitle", explanation: ["admin.plans.intro"] },
  planQuotas: { line: "admin.planQuotas.subtitle", explanation: ["admin.planQuotas.intro"] },
  coupons: { line: "admin.coupons.subtitle", explanation: ["admin.coupons.intro"] },
  humanCoaches: { line: "admin.humanCoaches.subtitle", explanation: ["admin.humanCoaches.intro"] },
  coachCost: { line: "admin.coachCost.subtitle", explanation: ["admin.coachCost.intro"] },
  coachingPlaybooks: { line: "admin.coachingPlaybooks.subtitle", explanation: ["admin.coachingPlaybooks.intro"] },
  guardrails: { line: "admin.guardrails.subtitle", explanation: ["admin.guardrails.intro"] },
  unansweredQuestions: { line: "admin.unansweredQuestions.subtitle", explanation: ["admin.unansweredQuestions.intro", "admin.unansweredQuestions.privacy"] },
  tools: { line: "admin.tools.subtitle", explanation: ["admin.tools.intro"] },
  administrators: { line: "admin.administrators.subtitle", explanation: ["admin.administrators.intro"] },
  aiUsage: { line: "admin.aiUsage.subtitle", explanation: ["admin.aiUsage.intro"] },
} as const satisfies Record<IntroPage, { line: string; explanation: readonly string[] }>;

/** `page`'s intro, its explanation filled with `values` (a retention, the Administrator's roles). */
export function pageIntro(t: TFunction, page: IntroPage, values: Record<string, string>): PageIntroText {
  const texts: { line: (typeof TEXTS)[IntroPage]["line"]; explanation: readonly (typeof TEXTS)[IntroPage]["explanation"][number][] } = TEXTS[page];
  const options: TOptions = values;
  return {
    line: t(texts.line),
    more: t("admin.pageIntro.more"),
    explanation: texts.explanation.map((key) => t(key, options)).join(" "),
  };
}
