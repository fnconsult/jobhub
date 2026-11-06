import { resources } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { articles } from "./index";
import { HELP_LOCALES, type HelpLocale } from "./types";

/**
 * #772: a Job Search launched from a Coach proposal is stopped from AI Activity, whose control is named
 * `aiActivity.live.stop.job_search` (« Arrêter la recherche d'offres »): the card's hint and the Help Article quote it word
 * for word (ADR-0065), not a shorter « Arrêter ».
 */
describe("the Job Search's stop control, quoted as it is labelled (#772)", () => {
  it.each(HELP_LOCALES)("in %s, the card's hint and page-job-searches quote it exactly", (locale: HelpLocale) => {
    const catalogue = resources[locale].translation as unknown as { aiActivity: { live: { stop: { job_search: string } } }; coachProposals: { launchedHint: string } };
    const label = catalogue.aiActivity.live.stop.job_search;
    const quoted = locale === "fr" ? `« ${label} »` : `“${label}”`;
    expect(catalogue.coachProposals.launchedHint).toContain(quoted);

    const article = articles(locale).find((each) => each.id === "page-job-searches");
    expect(article?.body).toContain(`« ${label} »`);
    expect(article?.body).not.toMatch(/«\s*(Arrêter|Stop)\s*»/);
  });
});
