import { isBackOfficeHelpTopic, type BackOfficeHelpTopic, type HelpArticle } from "@jobhub/help";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBackOffice } from "@/admin/server";
import { buttonClass } from "@/design/button-class";
import { Field, TextInput } from "@/design/Field";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/**
 * The Back Office's help (#551, ADR-0065): the Administrators' Help Articles, by topic, with their search. Every
 * Administrator reads it, whatever their Back Office Roles; anyone else gets a 404, like every Back Office page, and it
 * is never indexed nor in `sitemap.xml`. It shows an Administrator's article only, never a public one.
 */

/** The page's metadata: its title, never indexed. Reads the Back Office first, so a 404's title is not the Back Office's. */
export async function backOfficeHelpMetadata(title?: string): Promise<Metadata> {
  await requireBackOffice();
  const t = await getServerT();
  return { title: [title, t("admin.help.title"), t("admin.title")].filter(Boolean).join(" · "), robots: { index: false, follow: false } };
}

/** The Back Office help topic of an address, or a 404. */
export function backOfficeTopicOrNotFound(topic: string): BackOfficeHelpTopic {
  if (!isBackOfficeHelpTopic(topic)) notFound();
  return topic;
}

/** The search, without AI: a plain GET form to /admin/aide (`?q=`), so its results have an address. */
export async function BackOfficeHelpSearchForm({ query = "" }: { query?: string }) {
  const t = await getServerT();
  return (
    <form className="section-head section-filter" role="search" action={routes.adminHelp()} method="get">
      <Field label={t("admin.help.searchLabel")}>
        <TextInput type="search" name="q" defaultValue={query} />
      </Field>
      <button type="submit" className={buttonClass({ variant: "primary" })}>
        {t("admin.help.searchSubmit")}
      </button>
    </form>
  );
}

/** A list of Administrator articles, each its title (a link to its page in /admin/aide), its kind and, with `topics`, its topic. */
export async function BackOfficeHelpArticleList({ articles, topics = false }: { articles: readonly HelpArticle[]; topics?: boolean }) {
  const t = await getServerT();
  return (
    <ul className="section-list">
      {articles.map((article) => (
        <li key={article.id}>
          <Link href={routes.adminHelpArticle(article.topic, article.id)}>{article.title}</Link>{" "}
          <span className="section-meta">
            {t(`coachPanel.help.kinds.${article.kind}`)}
            {topics && isBackOfficeHelpTopic(article.topic) ? ` · ${t(`admin.help.topics.${article.topic}.title`)}` : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** « Aide du back office › <topic> », above a topic's or an article's title. */
export async function BackOfficeHelpBreadcrumb({ topic }: { topic?: BackOfficeHelpTopic }) {
  const t = await getServerT();
  return (
    <nav aria-label={t("admin.help.breadcrumb")}>
      <p className="section-meta">
        <Link href={routes.adminHelp()}>{t("admin.help.title")}</Link>
        {topic ? (
          <>
            {" › "}
            <Link href={routes.adminHelpTopic(topic)}>{t(`admin.help.topics.${topic}.title`)}</Link>
          </>
        ) : null}
      </p>
    </nav>
  );
}
