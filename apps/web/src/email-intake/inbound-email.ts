/**
 * An email Brevo Inbound Parsing posts (#442, docs/research/issue-442.md), as Email intake reads it: who sent it, to
 * which addresses, when, the Authentication-Results Brevo's MX stamped on it, and its text. Only its text part is
 * kept (the HTML rendered to text, each link written after its words, else the plain text part), capped; never its
 * other headers, images or attachments, which are not even read (CONTEXT.md, Received offer email). The text the HTML
 * hides from its reader is kept between HIDDEN_TEXT_OPEN and HIDDEN_TEXT_CLOSE, for the email Guardrail (#446).
 *
 *   const emails = readInboundEmails(await request.json()); // null: not Brevo's body
 */
import { htmlToText } from "@jobhub/shared/page-reading";
import { HIDDEN_TEXT_CLOSE, HIDDEN_TEXT_OPEN } from "../guardrails/email";

/** The most characters of an email's text kept: an alert of 30 offers fits many times over. */
export const MAX_TEXT_CHARACTERS = 50_000;

export interface InboundEmail {
  /** Brevo's MessageId, else its Uuid: one email delivered twice is received once. */
  messageId: string;
  /** The From address, in lower case. */
  from: string;
  /** The addresses it was delivered to (RCPT TO, else To), in lower case: a Forwarding address among them. */
  recipients: string[];
  /** The date the email says it was sent, or null when it says none that reads. */
  sentAt: Date | null;
  /**
   * The first Authentication-Results header: the one Brevo's MX added on receiving it, above any the email carried
   * (which anyone can write). Empty when there is none.
   */
  authenticationResults: string;
  /** Its text, capped at MAX_TEXT_CHARACTERS. */
  text: string;
}

type Item = Record<string, unknown>;

const isObject = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value);

function addressOf(value: unknown): string | null {
  const address = typeof value === "string" ? value : isObject(value) && typeof value.Address === "string" ? value.Address : null;
  const trimmed = address?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

const addressesOf = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap((entry) => addressOf(entry) ?? []) : []);

/** A header by name, any case; Brevo gives a string when it appears once, an array when more. */
function header(headers: unknown, name: string): string[] {
  if (!isObject(headers)) return [];
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : headers[key];
  return (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === "string");
}

/** An anchor's words followed by its link, so the reading keeps where each offer is; other links (mailto:, tracking images) go. */
function withLinks(html: string): string {
  return html.replace(/<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, words: string) => `${words} &lt;${href}&gt;`);
}

/** A style or attribute that hides an element from whoever reads the email: no display, no visibility, no size, no opacity. */
const HIDING_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:\.0+)?(?:px|pt|em|rem|%)?\s*(?:!important)?\s*(?:;|$)|opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*(?:;|$)|mso-hide\s*:\s*all)/i;

function hides(attributes: string): boolean {
  const style = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(attributes)?.[2] ?? "";
  return HIDING_STYLE.test(style) || /(?:^|\s)hidden(?:\s|=|$)/i.test(attributes.replace(/\b\w+\s*=\s*(["'])[\s\S]*?\1/g, " "));
}

/** Where the element opened before `from` closes: its closing tag, counting those of its name nested in it; -1 when none. */
function closingOf(html: string, tag: string, from: number): number {
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    if (match[1]) depth -= 1;
    else if (!match[0].endsWith("/>")) depth += 1;
    if (depth === 0) return match.index;
  }
  return -1;
}

/** The HTML with the content of each element it hides marked, so its text keeps the mark. */
function markHidden(html: string): string {
  const opening = /<([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let marked = "";
  let from = 0;
  for (let match = opening.exec(html); match; match = opening.exec(html)) {
    const [whole, tag, attributes] = match as unknown as [string, string, string];
    if (whole.endsWith("/>") || !hides(attributes)) continue;
    const start = match.index + whole.length;
    const end = closingOf(html, tag, start);
    if (end < 0) continue;
    marked += `${html.slice(from, start)}${HIDDEN_TEXT_OPEN}${html.slice(start, end).trim()}${HIDDEN_TEXT_CLOSE}`;
    from = end;
    opening.lastIndex = end;
  }
  return marked + html.slice(from);
}

/** An email's text as Email intake keeps it: its HTML rendered to text (links after their words, hidden text marked), else its text part; capped. */
export function inboundTextOf(parts: { html?: string | null; text?: string | null }): string {
  const html = typeof parts.html === "string" ? htmlToText(withLinks(markHidden(parts.html))) : "";
  const text = html || (typeof parts.text === "string" ? parts.text.trim() : "");
  return text.slice(0, MAX_TEXT_CHARACTERS);
}

const textOf = (item: Item): string =>
  inboundTextOf({ html: typeof item.RawHtmlBody === "string" ? item.RawHtmlBody : null, text: typeof item.RawTextBody === "string" ? item.RawTextBody : null });

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readItem(item: unknown): InboundEmail | null {
  if (!isObject(item)) return null;
  const from = addressOf(item.From);
  const messageId = typeof item.MessageId === "string" && item.MessageId.trim() ? item.MessageId.trim() : Array.isArray(item.Uuid) && typeof item.Uuid[0] === "string" ? item.Uuid[0] : null;
  if (!from || !messageId) return null;
  const recipients = addressesOf(item.Recipients);
  return {
    messageId,
    from,
    recipients: recipients.length > 0 ? recipients : addressesOf(item.To),
    sentAt: dateOf(item.SentAtDate),
    authenticationResults: header(item.Headers, "Authentication-Results")[0] ?? "",
    text: textOf(item),
  };
}

/** The emails of a Brevo Inbound Parsing body (`{ items: [...] }`), those without a sender left out; null for any other body. */
export function readInboundEmails(body: unknown): InboundEmail[] | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null;
  return body.items.flatMap((item) => readItem(item) ?? []);
}
