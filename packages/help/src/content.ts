/**
 * Reads and checks the Help Articles' Markdown files (`articles/<locale>/<id>.md`), and writes them as the
 * `articles.generated.ts` module the app bundles. Node only (reads files): never imported by `index.ts`.
 *
 *   const content = readHelpContent(); // throws HelpContentError when a translation is missing
 *   writeFileSync(generatedModulePath, renderArticlesModule(content));
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_ARTICLE_KINDS, HELP_AUDIENCES, HELP_LOCALES, PUBLIC_HELP_TOPICS, type HelpArticle, type HelpLocale } from "./types";

/** The Help Articles are inconsistent: a translation is missing, or a front matter is invalid. */
export class HelpContentError extends Error {
  override name = "HelpContentError";
}

export type HelpContent = Record<HelpLocale, HelpArticle[]>;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** This package's own articles directory. */
export const articlesDir = path.join(packageDir, "articles");

/** The module `index.ts` serves the articles from, written by `renderArticlesModule`. */
export const generatedModulePath = path.join(packageDir, "src", "articles.generated.ts");

const KIND_ORDER = Object.fromEntries(HELP_ARTICLE_KINDS.map((kind, index) => [kind, index]));

/** The source of `articles.generated.ts`: every article, page articles first, then the glossary, the questions and the tutorials, each by title. */
export function renderArticlesModule(content: HelpContent): string {
  const sorted = Object.fromEntries(
    HELP_LOCALES.map((locale) => [
      locale,
      [...content[locale]].sort((a, b) => KIND_ORDER[a.kind]! - KIND_ORDER[b.kind]! || a.title.localeCompare(b.title, locale)),
    ]),
  );
  return [
    "// Written by `npm run build -w @jobhub/help` from articles/<locale>/<id>.md: edit those, never this file.",
    'import type { HelpArticle, HelpLocale } from "./types";',
    "",
    `export const ARTICLES: Record<HelpLocale, readonly HelpArticle[]> = ${JSON.stringify(sorted, null, 2)};`,
    "",
  ].join("\n");
}

/** Reads every article of `dir` (default: this package's `articles/`). Throws `HelpContentError` listing every problem. */
export function readHelpContent(dir: string = articlesDir): HelpContent {
  const problems: string[] = [];
  const files = Object.fromEntries(HELP_LOCALES.map((locale) => [locale, markdownFiles(path.join(dir, locale))])) as Record<HelpLocale, string[]>;

  for (const locale of HELP_LOCALES) {
    for (const other of HELP_LOCALES.filter((candidate) => candidate !== locale)) {
      for (const file of files[locale].filter((name) => !files[other].includes(name)))
        problems.push(`${other}/${file} is missing: every Help Article is written in French and in English`);
    }
  }

  const content = Object.fromEntries(
    HELP_LOCALES.map((locale) => [
      locale,
      files[locale].map((file) => {
        const article = parseArticle(file.replace(/\.md$/, ""), locale, readFileSync(path.join(dir, locale, file), "utf8"));
        problems.push(...articleProblems(article).map((problem) => `${locale}/${file}: ${problem}`));
        return article;
      }),
    ]),
  ) as HelpContent;

  for (const locale of HELP_LOCALES) {
    const explained = new Map<string, string>();
    for (const article of content[locale]) {
      const where = `${locale}/${article.id}.md`;
      const french = content.fr.find((candidate) => candidate.id === article.id);
      if (locale !== "fr" && french) {
        if (article.kind !== french.kind) problems.push(`${where}: its kind ${article.kind} differs from the French one (${french.kind})`);
        else if (article.route !== french.route) problems.push(`${where}: its route ${article.route} differs from the French one (${french.route})`);
        if (article.audience !== french.audience) problems.push(`${where}: its audience ${article.audience} differs from the French one (${french.audience})`);
        if (article.topic !== french.topic) problems.push(`${where}: its topic ${article.topic} differs from the French one (${french.topic})`);
      }
      if (article.kind !== "page" || !article.route) continue;
      const other = explained.get(article.route);
      if (other) problems.push(`${where}: ${other} already explains ${article.route}`);
      else explained.set(article.route, article.id);
    }
  }

  if (problems.length > 0) throw new HelpContentError(problems.join("\n"));
  return content;
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/** What is wrong with one article on its own. */
function articleProblems(article: HelpArticle): string[] {
  const problems: string[] = [];
  if (!(HELP_ARTICLE_KINDS as readonly string[]).includes(article.kind)) problems.push(`kind must be ${orList(HELP_ARTICLE_KINDS)}`);
  if (!article.audience) problems.push(`audience is missing: one of ${orList(HELP_AUDIENCES)}`);
  else if (!(HELP_AUDIENCES as readonly string[]).includes(article.audience)) problems.push(`audience must be ${orList(HELP_AUDIENCES)}`);
  const publicTopic = (PUBLIC_HELP_TOPICS as readonly string[]).includes(article.topic);
  if (!article.topic) problems.push("topic is missing");
  else if (article.audience === "administrator") {
    if (publicTopic) problems.push(`an administrator article's topic is a Back Office one, never a public topic (${article.topic})`);
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(article.topic)) problems.push("topic must be a slug: lower-case letters, digits and hyphens");
  } else if (!publicTopic) problems.push(`topic must be ${orList(PUBLIC_HELP_TOPICS)}`);
  if (!article.title) problems.push("title is missing");
  if (article.kind === "tutorial" && numberedSteps(article.body) < 2) problems.push("a tutorial needs at least two numbered steps (« 1. … », « 2. … »)");
  if (!Array.isArray(article.synonyms)) problems.push("synonyms must be a list: [word, other word]");
  if (article.kind === "page" && !article.route) problems.push("a page article needs its route");
  if (article.kind !== "page" && article.route) problems.push("only a page article has a route");
  if (article.route && !article.route.startsWith("/")) problems.push("route must start with /");
  if (!article.body) problems.push("the body is empty");
  if (/!\[[^\]]*\]\(/.test(article.body) || /<img\b/i.test(article.body)) problems.push("no images in a Help Article");
  return problems;
}

/** « a, b or c ». */
function orList(values: readonly string[]): string {
  return values.join(", ").replace(/, (?=[^,]*$)/, " or ");
}

/** The numbered steps of a tutorial's body: its lines « 1. … », « 2. … », counted from 1 while they follow each other. */
export function numberedSteps(body: string): number {
  let next = 1;
  for (const line of body.split(/\r?\n/)) {
    const step = /^\s*(\d+)\.\s+\S/.exec(line);
    if (step && Number(step[1]) === next) next++;
  }
  return next - 1;
}

/** The article as its file says, unchecked: `articleProblems` says what is wrong with it. */
function parseArticle(id: string, locale: HelpLocale, markdown: string): HelpArticle {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  return {
    id,
    locale,
    kind: text(frontmatter.kind) as HelpArticle["kind"],
    audience: text(frontmatter.audience) as HelpArticle["audience"],
    topic: text(frontmatter.topic),
    title: text(frontmatter.title),
    synonyms: frontmatter.synonyms as string[],
    route: text(frontmatter.route) || null,
    body: body.trim(),
  };
}

export type Frontmatter = Record<string, string | string[]>;

/** Splits `---`-delimited front matter (flat `key: value` and `key: [a, b]` lines) from the body. */
export function parseFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { frontmatter: {}, body: markdown };
  const frontmatter: Frontmatter = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    const value = field[2]!.trim();
    const list = /^\[(.*)\]$/.exec(value);
    frontmatter[field[1]!] = list
      ? list[1]!
          .split(",")
          .map((item) => unquote(item.trim()))
          .filter(Boolean)
      : unquote(value);
  }
  return { frontmatter, body: markdown.slice(match[0].length) };
}

function unquote(value: string): string {
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}
