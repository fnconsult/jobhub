import { backOfficeHelpTopics, search } from "@jobhub/help";
import type { Metadata } from "next";
import Link from "next/link";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { Card } from "@/design/Card";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { BackOfficeHelpArticleList, backOfficeHelpMetadata, BackOfficeHelpSearchForm } from "./back-office-help";
import "../section.css";

export async function generateMetadata(): Promise<Metadata> {
  return backOfficeHelpMetadata();
}

/** How many articles a search shows at most. */
const SEARCH_LIMIT = 20;

/**
 * « Aide du back office » (#551, ADR-0065): the search, without AI, over the Administrators' Help Articles only, its
 * results when `q` is given, then the Back Office's topics, « Fournisseurs et Tools » first and « IA et conformité »
 * last, each with its articles. Every Administrator reads it; a 404 for anyone else; never indexed.
 */
export default async function BackOfficeHelpPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { access } = await requireBackOffice();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const asked = (await searchParams).q;
  const query = (Array.isArray(asked) ? asked[0] : asked)?.trim() ?? "";
  const found = query ? search(query, locale, { limit: SEARCH_LIMIT, scope: "backOffice" }) : [];
  return (
    <BackOfficeLayout access={access} title={t("admin.help.title")}>
      <div className="section-page">
        <p>{t("admin.help.subtitle")}</p>
        <BackOfficeHelpSearchForm query={query} />
        {query ? (
          <section aria-labelledby="back-office-help-results" className="section-page">
            <div role="status">
              <h2 id="back-office-help-results">{found.length > 0 ? t("admin.help.results", { count: found.length, query }) : t("admin.help.noResults", { query })}</h2>
            </div>
            {found.length > 0 ? <BackOfficeHelpArticleList articles={found} topics /> : null}
          </section>
        ) : null}
        <h2>{t("admin.help.topicsTitle")}</h2>
        {backOfficeHelpTopics(locale).map(({ topic, articles }) => (
          <Card key={topic} title={<Link href={routes.adminHelpTopic(topic)}>{t(`admin.help.topics.${topic}.title`)}</Link>} headingLevel={3} headingId={`back-office-help-${topic}`}>
            <p>{t(`admin.help.topics.${topic}.description`)}</p>
            {articles.length > 0 ? <BackOfficeHelpArticleList articles={articles} /> : <p className="section-meta">{t("admin.help.emptyTopic")}</p>}
          </Card>
        ))}
      </div>
    </BackOfficeLayout>
  );
}
