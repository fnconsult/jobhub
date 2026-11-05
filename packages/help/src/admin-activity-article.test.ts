import { resources } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { articleFor } from "./index";
import { HELP_LOCALES, type HelpLocale } from "./types";

/**
 * #731: Activité › Appels IA shows, for a call that wrote an AI Coach reply, its context estimated against the provider's
 * count. The `page` article of the route (docs/agents/documentation.md) quotes that column word for word, FR and EN.
 */
describe("the Activité page article (#731)", () => {
  it.each(HELP_LOCALES)("quotes the Appels IA tab's context column in %s", (locale: HelpLocale) => {
    const article = articleFor("/admin/activite/appels-ia", locale, { scope: "backOffice" });
    expect(article?.id).toBe("page-admin-activity");
    expect(article?.body).toContain(`« ${resources[locale].translation.admin.aiMessages.context} »`);
  });
});
