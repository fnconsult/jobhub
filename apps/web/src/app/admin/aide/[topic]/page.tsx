import { backOfficeHelpTopics } from "@jobhub/help";
import type { Metadata } from "next";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { BackOfficeHelpArticleList, BackOfficeHelpBreadcrumb, backOfficeHelpMetadata, backOfficeTopicOrNotFound } from "../back-office-help";
import "../../section.css";

type Params = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const topic = backOfficeTopicOrNotFound((await params).topic);
  const t = await getServerT();
  return backOfficeHelpMetadata(t(`admin.help.topics.${topic}.title`));
}

/** A topic of the Back Office's help (#551): its Administrator articles, or « Bientôt des articles ici »; a 404 for any other address. */
export default async function BackOfficeHelpTopicPage({ params }: Params) {
  const { access } = await requireBackOffice();
  const topic = backOfficeTopicOrNotFound((await params).topic);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const articles = backOfficeHelpTopics(locale).find((entry) => entry.topic === topic)?.articles ?? [];
  return (
    <BackOfficeLayout access={access} title={t(`admin.help.topics.${topic}.title`)}>
      <div className="section-page">
        <BackOfficeHelpBreadcrumb />
        <p>{t(`admin.help.topics.${topic}.description`)}</p>
        {articles.length > 0 ? <BackOfficeHelpArticleList articles={articles} /> : <p className="section-meta">{t("admin.help.emptyTopic")}</p>}
      </div>
    </BackOfficeLayout>
  );
}
