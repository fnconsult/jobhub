import { backOfficeHelpArticle, type BackOfficeHelpTopic } from "@jobhub/help";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { CoachReplyText } from "@/components/CoachReplyText";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { BackOfficeHelpBreadcrumb, backOfficeHelpMetadata, backOfficeTopicOrNotFound } from "../../back-office-help";
import "../../../section.css";

type Params = { params: Promise<{ topic: string; article: string }> };

/** The Administrator article an address names, in the page's language; a 404 for any other, a public one included. */
async function shown({ params }: Params) {
  const { topic, article: id } = await params;
  const found = backOfficeHelpArticle(backOfficeTopicOrNotFound(topic), id, await getRequestLocale());
  if (!found) notFound();
  return found;
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  // The Back Office first: a non-Administrator's 404 never names the article.
  const metadata = await backOfficeHelpMetadata();
  const article = await shown(props);
  return { ...metadata, title: `${article.title} · ${String(metadata.title)}` };
}

/**
 * An Administrator's Help Article in the Back Office's help (#551): its topic, its kind, its text (a tutorial's numbered
 * steps as a numbered list) and « Écrit par l'équipe Jobbbox ». Every Administrator reads it; a 404 for anyone else.
 */
export default async function BackOfficeHelpArticlePage(props: Params) {
  const { access } = await requireBackOffice();
  const article = await shown(props);
  const t = await getServerT(article.locale);
  return (
    <BackOfficeLayout access={access} title={article.title}>
      <article className="section-page" aria-label={article.title}>
        <BackOfficeHelpBreadcrumb topic={article.topic as BackOfficeHelpTopic} />
        <p className="section-meta">
          {t(`coachPanel.help.kinds.${article.kind}`)} · {t("helpCentre.writtenBy")}
        </p>
        <CoachReplyText text={article.body} />
      </article>
    </BackOfficeLayout>
  );
}
