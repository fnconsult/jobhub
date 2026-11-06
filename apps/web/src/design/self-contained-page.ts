/**
 * A whole HTML page with nothing to load (#542): inline styles from the design tokens, no React, no font file, no
 * session. For the answers given when what renders the app's pages may be down: maintenance's 503 (`src/maintenance`),
 * and the pages the proxy serves while the web app does not answer (`src/edge`, deploy/edge). Both languages, in the
 * order asked, in both themes.
 */
import { designTokens } from "@jobhub/shared/design";

export interface SelfContainedPage {
  /** The language of the document: the one of its first section. */
  lang: "fr" | "en";
  /** The document's `<title>`. */
  title: string;
  /** The status shown above the text, as on the app's error pages. */
  code: number;
  /** One section per language, already escaped HTML, each in its own `lang`. */
  sections: { lang: "fr" | "en"; html: string }[];
  /** The one button, a link reloading the page. */
  action: string;
  /** More of `<head>`, already escaped HTML. */
  head?: string;
}

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function selfContainedPage(page: SelfContainedPage): string {
  const { color, fontFamily } = designTokens;
  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
${page.head ?? ""}<title>${page.title}</title>
<style>
:root{--bg:${color.background.light};--text:${color.text.light};--secondary:${color.secondary.light};--border:${color.border.light};--accent:${color.accent.light};--on-accent:${color.onAccent.light}}
@media (prefers-color-scheme: dark){:root{--bg:${color.background.dark};--text:${color.text.dark};--secondary:${color.secondary.dark};--border:${color.border.dark};--accent:${color.accent.dark};--on-accent:${color.onAccent.dark}}}
body{margin:0;background:var(--bg);color:var(--text);font-family:${fontFamily.sans};font-size:1.125rem;line-height:1.6}
main{max-width:36rem;margin:0 auto;padding:4rem 1rem}
.wordmark{margin:0 0 2.5rem;font-size:1.25rem;font-weight:700;letter-spacing:-0.02em}
.code{margin:0;color:var(--secondary);font-size:2.5rem;font-weight:300;font-variant-numeric:tabular-nums}
h1{margin:.5rem 0;font-size:1.5rem;font-weight:500;line-height:1.3}
p{margin:0 0 .75rem}
.meta{color:var(--secondary)}
section+section{margin-top:2rem;padding-top:2rem;border-top:1px solid var(--border)}
a{display:inline-block;margin-top:2rem;padding:.625rem 1.25rem;border-radius:999px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:500}
</style>
</head>
<body>
<main>
<p class="wordmark">Jobbbox</p>
<p class="code" aria-hidden="true">${page.code}</p>
${page.sections.map((section) => `<section lang="${section.lang}">${section.html}</section>`).join("\n")}
<a href="">${page.action}</a>
</main>
</body>
</html>
`;
}
