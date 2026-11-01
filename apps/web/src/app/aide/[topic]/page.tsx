import { helpCentreTopics } from "@jobhub/help";
import type { Metadata } from "next";
import { EmptyState } from "@/design/EmptyState";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { HelpArticleList, HelpBreadcrumb, HelpSearchForm, topicOrNotFound } from "../help-centre";

type Params = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const topic = topicOrNotFound((await params).topic);
  return { title: `${t(`helpCentre.topics.${topic}.title`)} · ${t("helpCentre.title")} · ${t("app.name")}` };
}

/**
 * A topic of the Help Centre (#549): its public articles, in the page's language; « Bientôt des articles ici » while it
 * has none, never a 404. Any other address under /aide is a 404.
 */
export default async function HelpTopicPage({ params }: Params) {
  const topic = topicOrNotFound((await params).topic);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const articles = helpCentreTopics(locale).find((entry) => entry.topic === topic)!.articles;
  return (
    <PublicSite current="aide">
      <main id="main" className="ds-site__page">
        <header className="ds-site__intro">
          <HelpBreadcrumb />
          <h1 className="ds-site__title">{t(`helpCentre.topics.${topic}.title`)}</h1>
          <p className="ds-site__subtitle">{t(`helpCentre.topics.${topic}.description`)}</p>
        </header>
        <HelpSearchForm />
        {articles.length > 0 ? (
          <HelpArticleList articles={articles} label={t("helpCentre.inTopic")} />
        ) : (
          <EmptyState title={t("helpCentre.emptyTopic")}>{t("helpCentre.emptyTopicText")}</EmptyState>
        )}
      </main>
    </PublicSite>
  );
}
