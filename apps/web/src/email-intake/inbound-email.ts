/**
 * An email Brevo Inbound Parsing posts (#442, docs/research/issue-442.md), as Email intake reads it: who sent it, to
 * which addresses, when, the Authentication-Results Brevo's MX stamped on it, and its text. Only its text part is
 * kept (the HTML rendered to text, each link written after its words, else the plain text part), capped; never its
 * other headers, images or attachments, which are not even read (CONTEXT.md, Received offer email).
 *
 *   const emails = readInboundEmails(await request.json()); // null: not Brevo's body
 */
import { htmlToText } from "@jobhub/shared/page-reading";

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

function textOf(item: Item): string {
  const html = typeof item.RawHtmlBody === "string" ? htmlToText(withLinks(item.RawHtmlBody)) : "";
  const text = html || (typeof item.RawTextBody === "string" ? item.RawTextBody.trim() : "");
  return text.slice(0, MAX_TEXT_CHARACTERS);
}

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
