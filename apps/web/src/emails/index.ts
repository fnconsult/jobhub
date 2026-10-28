/**
 * The emails' one layout, in the Design System (ADR-0053, Confort Density): what an email says (`Email`) becomes
 * its two parts, the plain text and the HTML, so the two never tell different things.
 *
 * The HTML is what mail clients read: table-based, every style inline (Gmail drops a `<style>` in the body, Outlook
 * ignores most CSS), its colours and sizes taken from the tokens, never copied by hand. A `<style>` in the head only
 * adds the dark theme's token values for clients that follow `prefers-color-scheme`; the light palette stays legible
 * when a client inverts it. No image, no external stylesheet, no web font: the logo square is a table cell.
 *
 * Every email: a header (the logo square and « Jobbbox »), a body (its title, greeting, text, cards and at most one
 * primary button, then the signature), a footer (why the email came, its unsubscribe or settings link, and the
 * sender's address, which the mailer writes in with `withSenderAddress`).
 */
import { designTokens } from "@jobhub/shared/design";
import { createI18n, type Locale } from "@jobhub/shared/i18n";

/** A link: its words and an http(s) URL. */
export interface EmailLink {
  label: string;
  url: string;
}

/** A card in the body: an offer, an appointment, a failure. */
export interface EmailCard {
  title: string;
  /** Beside the title in the text part, first on its line of metadata in the HTML: an employer and place. */
  subtitle?: string;
  /** Metadata: one line each in the text part, joined by « · » in the HTML. */
  details?: string[];
  /** Where the title leads. */
  url?: string;
}

/** A paragraph, a card (consecutive cards make one list), or the email's one primary button. */
export type EmailBlock = string | { card: EmailCard } | { action: EmailLink };

/** What an email says, before its layout. The greeting and the signature come with the layout, in `language`. */
export interface Email {
  language: Locale;
  subject: string;
  /** The heading atop the HTML body; the subject says it in the text part. */
  title: string;
  body: EmailBlock[];
  footer: {
    /** Why the person gets this email. */
    reason: string;
    /** The unsubscribe link, or the settings that switch the email off. */
    link?: EmailLink;
  };
}

/** An email ready for a mailer: its subject and both parts. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Both parts of `email`. Throws on a second primary button or a link that is not http(s). */
export function renderEmail(email: Email): RenderedEmail {
  const links = [...email.body.flatMap((block) => (typeof block === "string" ? [] : "card" in block ? (block.card.url ? [block.card.url] : []) : [block.action.url])), ...(email.footer.link ? [email.footer.link.url] : [])];
  for (const url of links) if (!/^https?:\/\//i.test(url)) throw new Error(`An email's links must be http(s): ${url}`);
  if (email.body.filter((block) => typeof block !== "string" && "action" in block).length > 1) throw new Error("An email has at most one primary button");
  const { t } = createI18n(email.language);
  const words = { greeting: t("emails.greeting"), signature: t("emails.signature"), lead: (label: string) => t("emails.linkLead", { label }) };
  return { subject: email.subject, text: textPart(email, words), html: htmlPart(email, words) };
}

type Words = { greeting: string; signature: string; lead: (label: string) => string };

function textPart(email: Email, words: Words): string {
  const body = email.body.map((block) => {
    if (typeof block === "string") return block;
    if ("action" in block) return `${words.lead(block.action.label)}\n${block.action.url}`;
    const { title, subtitle, details = [], url } = block.card;
    return [`- ${title}${subtitle ? ` (${subtitle})` : ""}`, ...[...details, ...(url ? [url] : [])].map((line) => `  ${line}`)].join("\n");
  });
  const { reason, link } = email.footer;
  return [words.greeting, ...body, words.signature, `--\n${reason}`, ...(link ? [`${words.lead(link.label)}\n${link.url}`] : [])].join("\n\n");
}

const { color, density, radius, fontFamily, lineHeight } = designTokens;
const confort = density.confort;
const light = (token: keyof typeof color) => color[token].light;

/** The marker the sender's address replaces (`withSenderAddress`): a comment, so an email sent without it shows nothing. */
const SENDER_MARKER = "<!--jobbbox:sender-->";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Inline style from property → value pairs. */
const css = (style: Record<string, string | number | undefined>) =>
  Object.entries(style)
    .filter(([, value]) => value !== undefined)
    .map(([property, value]) => `${property.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${typeof value === "number" ? `${value}px` : value}`)
    .join(";");

const font = { fontFamily: fontFamily.sans.replace(/"/g, "'") };
const paragraph = css({ margin: "0 0 16px", ...font, fontSize: confort.fontSize.body, lineHeight: String(confort.lineHeight), color: light("text") });
const metaText = { ...font, fontSize: confort.metaFontSize, lineHeight: "1.5", color: light("meta") };
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** The dark theme's token values, for clients that follow `prefers-color-scheme` (and Outlook.com's `data-ogsc`). */
function darkStyle(): string {
  const dark = (token: keyof typeof color) => color[token].dark;
  const rules = [
    [".jb-page", `background-color:${dark("surface")} !important`],
    [".jb-card", `background-color:${dark("background")} !important;border-color:${dark("border")} !important`],
    [".jb-line", `border-color:${dark("border")} !important`],
    [".jb-list", `background-color:${dark("surface")} !important;border-color:${dark("border")} !important`],
    [".jb-text", `color:${dark("text")} !important`],
    [".jb-secondary", `color:${dark("secondary")} !important`],
    [".jb-meta", `color:${dark("meta")} !important`],
    [".jb-footer", `background-color:${dark("surface")} !important;border-color:${dark("border")} !important`],
    [".jb-accent", `background-color:${dark("accent")} !important;color:${dark("onAccent")} !important`],
  ];
  const block = (prefix: string) => rules.map(([selector, declarations]) => `${prefix}${selector}{${declarations}}`).join("\n");
  return `:root{color-scheme:light dark;supported-color-schemes:light dark}\n@media (prefers-color-scheme: dark){\n${block("")}\n}\n${block("[data-ogsc] ")}`;
}

function cards(list: EmailCard[]): string {
  const rows = list.map(({ title, subtitle, details = [], url }, index) => {
    const name = url
      ? `<a href="${escape(url)}" class="jb-text" style="${css({ color: light("text"), fontWeight: "600", textDecoration: "none" })}">${escape(title)}</a>`
      : `<strong class="jb-text" style="${css({ color: light("text"), fontWeight: "600" })}">${escape(title)}</strong>`;
    const meta = [subtitle, ...details].filter((line): line is string => Boolean(line));
    const metaLine = meta.length ? `<span class="jb-meta" style="${css({ display: "block", marginTop: 2, ...metaText })}">${escape(meta.join(" · "))}</span>` : "";
    const border = index > 0 ? { borderTop: `1px solid ${light("border")}` } : {};
    return `<tr><td class="jb-line" style="${css({ padding: `${confort.rowPadding}px 16px`, ...border, ...font, fontSize: confort.fontSize.body, lineHeight: String(confort.lineHeight), color: light("text") })}">${name}${metaLine}</td></tr>`;
  });
  return `<table ${TABLE} width="100%" class="jb-list" style="${css({ margin: "0 0 16px", borderCollapse: "separate", backgroundColor: light("surface"), border: `1px solid ${light("border")}`, borderRadius: radius.card })}">${rows.join("")}</table>`;
}

function button({ label, url }: EmailLink): string {
  const height = confort.controlHeight;
  return (
    `<table ${TABLE} style="margin:8px 0 24px"><tr>` +
    `<td class="jb-accent" style="${css({ backgroundColor: light("accent"), borderRadius: radius.control })}">` +
    `<a href="${escape(url)}" data-button="primary" class="jb-accent" style="${css({ display: "inline-block", padding: "0 20px", ...font, fontSize: confort.fontSize.body, fontWeight: "600", lineHeight: `${height}px`, color: light("onAccent"), backgroundColor: light("accent"), textDecoration: "none", borderRadius: radius.control })}">${escape(label)}</a>` +
    `</td></tr></table>`
  );
}

function htmlBody(email: Email, words: Words): string {
  const parts: string[] = [
    `<h1 class="jb-text" style="${css({ margin: "0 0 16px", ...font, fontSize: confort.fontSize.h2, lineHeight: String(lineHeight.heading), fontWeight: "600", color: light("text") })}">${escape(email.title)}</h1>`,
    `<p class="jb-text" style="${paragraph}">${escape(words.greeting)}</p>`,
  ];
  let run: EmailCard[] = [];
  const flush = () => {
    if (run.length) parts.push(cards(run));
    run = [];
  };
  for (const block of email.body) {
    if (typeof block !== "string" && "card" in block) {
      run.push(block.card);
      continue;
    }
    flush();
    parts.push(typeof block === "string" ? `<p class="jb-text" style="${paragraph}">${escape(block).replace(/\n/g, "<br>")}</p>` : button(block.action));
  }
  flush();
  parts.push(`<p class="jb-secondary" style="${css({ margin: 0, ...font, fontSize: confort.fontSize.body, lineHeight: String(confort.lineHeight), color: light("secondary") })}">${escape(words.signature)}</p>`);
  return parts.join("\n");
}

function htmlPart(email: Email, words: Words): string {
  const { reason, link } = email.footer;
  const footerLink = link ? `<br><a href="${escape(link.url)}" class="jb-meta" style="${css({ ...metaText, textDecoration: "underline" })}">${escape(link.label)}</a>` : "";
  const logoSize = 24;
  return `<!doctype html>
<html lang="${email.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(email.subject)}</title>
<style>
${darkStyle()}
</style>
</head>
<body class="jb-page" style="${css({ margin: 0, padding: 0, backgroundColor: light("surface") })}">
<table ${TABLE} width="100%" class="jb-page" style="${css({ backgroundColor: light("surface") })}"><tr><td align="center" style="padding:24px 16px">
<table ${TABLE} width="600" class="jb-card" style="${css({ width: "100%", maxWidth: 600, borderCollapse: "separate", backgroundColor: light("background"), border: `1px solid ${light("border")}`, borderRadius: radius.card })}">
<tr><td class="jb-line" style="${css({ padding: "20px 24px", borderBottom: `1px solid ${light("border")}` })}">
<table ${TABLE}><tr>
<td width="${logoSize}" height="${logoSize}" align="center" class="jb-accent" style="${css({ width: logoSize, height: logoSize, backgroundColor: light("accent"), color: light("onAccent"), borderRadius: radius.md, ...font, fontSize: 12, fontWeight: "700", lineHeight: `${logoSize}px`, textAlign: "center" })}">J</td>
<td class="jb-text" style="${css({ paddingLeft: 8, ...font, fontSize: confort.fontSize.body, fontWeight: "600", color: light("text") })}">Jobbbox</td>
</tr></table>
</td></tr>
<tr><td style="padding:24px">
${htmlBody(email, words)}
</td></tr>
<tr><td class="jb-footer jb-meta" style="${css({ padding: "16px 24px", backgroundColor: light("surface"), borderTop: `1px solid ${light("border")}`, borderRadius: `0 0 ${radius.card}px ${radius.card}px`, ...metaText })}">${escape(reason)}${footerLink}${SENDER_MARKER}</td></tr>
</table>
</td></tr></table>
</body>
</html>
`;
}

/** `html` with the sender's address (MAIL_FROM: "Jobbbox <hello@jobbbox.ai>" or a bare address) at the foot of its footer. */
export function withSenderAddress(html: string, from: string): string {
  const address = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from.trim();
  return html.replace(SENDER_MARKER, `<br><span class="jb-meta" style="${css(metaText)}">${escape(address)}</span>`);
}
