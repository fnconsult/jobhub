import { isPublicHelpTopic, type HelpArticle, type PublicHelpTopic } from "@jobhub/help";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/design/button-class";
import { Field, TextInput } from "@/design/Field";
import { getChosenLocale, getServerT, getUrlLocale } from "@/i18n/server";
import { localePath, shellHref } from "@/public-pages/public-shell";
import { routes } from "@/routes";
import "./help-centre.css";

/**
 * A Help Centre address (#549) in the language of the page's URL (#545): under /en in English, with `lang` when the URL
 * had one, like the public shell's links.
 */
export async function helpCentreHref(path: string): Promise<string> {
  return shellHref(path, { url: await getUrlLocale(), lang: await getChosenLocale() });
}

/** The topic of an address, or a 404: /aide/<anything else> is no page. */
export function topicOrNotFound(topic: string): PublicHelpTopic {
  if (!isPublicHelpTopic(topic)) notFound();
  return topic;
}

/**
 * The Help Centre's search, without AI (#549): a plain GET form to /aide (`?q=`), so it works without JavaScript and
 * its results have an address.
 */
export async function HelpSearchForm({ query = "" }: { query?: string }) {
  const t = await getServerT();
  const lang = await getChosenLocale();
  return (
    <form className="help-centre__search" role="search" action={localePath(routes.help, await getUrlLocale())} method="get">
      <Field label={t("helpCentre.searchLabel")}>
        <TextInput type="search" name="q" defaultValue={query} />
      </Field>
      {lang ? <input type="hidden" name="lang" value={lang} /> : null}
      <button type="submit" className={buttonClass({ variant: "primary" })}>
        {t("helpCentre.searchSubmit")}
      </button>
    </form>
  );
}

/** A list of Help Articles, each its title (a link to its page in the Help Centre), its kind and, with `topics`, its topic. */
export async function HelpArticleList({ articles, topics = false, label }: { articles: readonly HelpArticle[]; topics?: boolean; label?: string }) {
  const t = await getServerT();
  const hrefs = await Promise.all(articles.map((article) => helpCentreHref(routes.helpArticle(article.topic, article.id))));
  return (
    <ul className="help-centre__articles" aria-label={label}>
      {articles.map((article, at) => (
        <li key={article.id}>
          <Link href={hrefs[at]!}>{article.title}</Link>
          <span className="help-centre__meta">
            {t(`coachPanel.help.kinds.${article.kind}`)}
            {topics && isPublicHelpTopic(article.topic) ? ` · ${t(`helpCentre.topics.${article.topic}.title`)}` : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** « Aide › <topic> », above a topic's or an article's title. */
export async function HelpBreadcrumb({ topic }: { topic?: PublicHelpTopic }) {
  const t = await getServerT();
  return (
    <nav className="help-centre__breadcrumb" aria-label={t("helpCentre.breadcrumb")}>
      <ol>
        <li>
          <Link href={await helpCentreHref(routes.help)}>{t("helpCentre.title")}</Link>
        </li>
        {topic ? (
          <li>
            <Link href={await helpCentreHref(routes.helpTopic(topic))}>{t(`helpCentre.topics.${topic}.title`)}</Link>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
