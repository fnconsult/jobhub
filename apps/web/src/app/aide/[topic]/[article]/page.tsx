import { helpCentreArticle, relatedArticles } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoachReplyText } from "@/components/CoachReplyText";
import { PublicSite } from "@/design/PublicSite";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { HelpArticleList, HelpBreadcrumb, topicOrNotFound } from "../../help-centre";

type Params = { params: Promise<{ topic: string; article: string }> };

/** The public article an address names, in the page's language; a 404 for any other, an Administrator's above all. */
async function shown({ params }: Params) {
  const { topic, article: id } = await params;
  const locale = await getRequestLocale();
  const found = helpCentreArticle(topicOrNotFound(topic), id, locale);
  if (!found) notFound();
  return found;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${(await shown(props)).title} · ${t("helpCentre.title")} · ${t("app.name")}` };
}

/**
 * A Help Article in the Help Centre (#549): its topic, its kind, its text (a tutorial's numbered steps as a numbered
 * list), « Écrit par l'équipe Jobbbox » (ADR-0065: an agent drafts, a person reviews and merges), then its related
 * articles. Open to everyone; in English under /en/aide/… (src/proxy.ts).
 */
export default async function HelpArticlePage(props: Params) {
  const article = await shown(props);
  const t = await getServerT(article.locale);
  const related = relatedArticles(article);
  return (
    <PublicSite current="aide">
      <main id="main" className="ds-site__page">
        <article className="help-centre__article" aria-labelledby="help-article-title">
          <header className="ds-site__intro">
            <HelpBreadcrumb topic={topicOrNotFound(article.topic)} />
            <p className="ds-site__eyebrow">{t(`coachPanel.help.kinds.${article.kind}`)}</p>
            <h1 className="ds-site__title" id="help-article-title">
              {article.title}
            </h1>
            <p className="help-centre__meta">{t("helpCentre.writtenBy")}</p>
          </header>
          <div className="help-centre__body">
            <CoachReplyText text={article.body} />
          </div>
        </article>
        {related.length > 0 ? (
          <section className="help-centre__section" aria-labelledby="help-related">
            <h2 id="help-related">{t("helpCentre.related")}</h2>
            <HelpArticleList articles={related} />
          </section>
        ) : null}
      </main>
    </PublicSite>
  );
}
