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
import { HELP_ARTICLE_KINDS, HELP_LOCALES, type HelpArticle, type HelpLocale } from "./types";

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

/** The source of `articles.generated.ts`: every article, page articles first, then the glossary, then the questions, each by title. */
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
  if (!(HELP_ARTICLE_KINDS as readonly string[]).includes(article.kind)) problems.push(`kind must be ${HELP_ARTICLE_KINDS.join(", ").replace(/, (?=[^,]*$)/, " or ")}`);
  if (!article.title) problems.push("title is missing");
  if (!Array.isArray(article.synonyms)) problems.push("synonyms must be a list: [word, other word]");
  if (article.kind === "page" && !article.route) problems.push("a page article needs its route");
  if (article.kind !== "page" && article.route) problems.push("only a page article has a route");
  if (article.route && !article.route.startsWith("/")) problems.push("route must start with /");
  if (!article.body) problems.push("the body is empty");
  if (/!\[[^\]]*\]\(/.test(article.body) || /<img\b/i.test(article.body)) problems.push("no images in a Help Article");
  return problems;
}

/** The article as its file says, unchecked: `articleProblems` says what is wrong with it. */
function parseArticle(id: string, locale: HelpLocale, markdown: string): HelpArticle {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const text = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
  return {
    id,
    locale,
    kind: text(frontmatter.kind) as HelpArticle["kind"],
    title: text(frontmatter.title),
    synonyms: frontmatter.synonyms as string[],
    route: text(frontmatter.route) || null,
    body: body.trim(),
  };
}

type Frontmatter = Record<string, string | string[]>;

/** Splits `---`-delimited front matter (flat `key: value` and `key: [a, b]` lines) from the body. */
function parseFrontmatter(markdown: string): { frontmatter: Frontmatter; body: string } {
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
