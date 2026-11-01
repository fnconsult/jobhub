import { helpCentreTopics, search } from "@jobhub/help";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { publicMetadata } from "@/public-pages/indexing-server";
import { routes } from "@/routes";
import { helpCentreHref, HelpArticleList, HelpSearchForm } from "./help-centre";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("helpCentre.title")} · ${t("app.name")}`, ...(await publicMetadata(routes.help, ["fr", "en"])) };
}

/** How many public articles a search shows at most. */
const SEARCH_LIMIT = 20;

/**
 * The Help Centre (#549, ADR-0065), open to everyone, in the page's language: the search, without AI, over every
 * public Help Article (never an Administrator's), its results when `q` is given, then the four topics, named by task,
 * each leading to its articles, or saying « Bientôt des articles ici » while it has none.
 */
export default async function HelpCentrePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const asked = (await searchParams).q;
  const query = (Array.isArray(asked) ? asked[0] : asked)?.trim() ?? "";
  const found = query ? search(query, locale, { limit: SEARCH_LIMIT }) : [];
  const topics = await Promise.all(helpCentreTopics(locale).map(async (entry) => ({ ...entry, href: await helpCentreHref(routes.helpTopic(entry.topic)) })));
  return (
    <PublicSite current="aide">
      <main id="main" className="ds-site__page">
        <header className="ds-site__intro">
          <p className="ds-site__eyebrow">{t("helpCentre.eyebrow")}</p>
          <h1 className="ds-site__title">{t("helpCentre.title")}</h1>
          <p className="ds-site__subtitle">{t("helpCentre.subtitle")}</p>
        </header>
        <HelpSearchForm query={query} />
        {query ? (
          <section className="help-centre__section" aria-labelledby="help-results">
            <div role="status">
              <h2 id="help-results">{found.length > 0 ? t("helpCentre.results", { count: found.length, query }) : t("helpCentre.noResults", { query })}</h2>
            </div>
            {found.length > 0 ? <HelpArticleList articles={found} topics /> : null}
          </section>
        ) : null}
        <section className="help-centre__section" aria-labelledby="help-topics">
          <h2 id="help-topics">{t("helpCentre.topicsTitle")}</h2>
          <ul className="help-centre__topics">
            {topics.map(({ topic, articles, href }) => (
              <li key={topic}>
                <section className="help-centre__topic" aria-labelledby={`help-topic-${topic}`}>
                  <h3 id={`help-topic-${topic}`}>
                    <Link href={href}>{t(`helpCentre.topics.${topic}.title`)}</Link>
                  </h3>
                  <p>{t(`helpCentre.topics.${topic}.description`)}</p>
                  <p className="help-centre__meta">{articles.length > 0 ? t("helpCentre.articleCount", { count: articles.length }) : t("helpCentre.emptyTopic")}</p>
                </section>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </PublicSite>
  );
}
