/**
 * An email Email intake's MTA posts (#580): its raw message and, beside it, the envelope's
 * recipients and the MTA's own Authentication-Results (inbound-headers.ts). As Email intake reads it: who sent it, to
 * which addresses, when, how the MTA authenticated it, and its text. Only its text part is kept (the HTML rendered to
 * text, each link written after its words, else the plain text part), capped; never its other headers, images or
 * attachments (CONTEXT.md, Received offer email). The text the HTML hides from its reader is kept between
 * HIDDEN_TEXT_OPEN and HIDDEN_TEXT_CLOSE, for the email Guardrail (#446).
 *
 * A message the Candidate forwards as an attachment (`message/rfc822`: Apple Mail's and iCloud's « Transférer en tant
 * que pièce jointe », #1193) is the email to read, not an attachment: its text follows theirs, under a forward's
 * header block (FORWARDED_MESSAGE_MARK, its From, Date and Subject), as an inline forward writes it. The original
 * sender, `forwardedFrom`, is that message's From, else the first forwarded header block in the text (Apple Mail's
 * « Début du message réexpédié : » or « Begin forwarded message: », Gmail's, Outlook's).
 *
 *   const email = await readInboundEmail(request); // null: not an email with a sender
 */
import { createHash } from "node:crypto";
import { htmlToText } from "@jobhub/shared/page-reading";
import PostalMime from "postal-mime";
import { HIDDEN_TEXT_CLOSE, HIDDEN_TEXT_OPEN } from "../guardrails/email";
import { AUTHENTICATION_RESULTS_HEADER, ENVELOPE_TO_HEADER } from "./inbound-headers";

/** The most characters of an email's text kept: an alert of 30 offers fits many times over. */
export const MAX_TEXT_CHARACTERS = 50_000;

export interface InboundEmail {
  /** Its Message-ID, else a digest of what it holds: one email delivered twice is received once. */
  messageId: string;
  /** The From address, in lower case. */
  from: string;
  /** The addresses it was delivered to (the envelope's RCPT TO, else its To), in lower case: a Forwarding address among them. */
  recipients: string[];
  /** The date the email says it was sent, or null when it says none that reads. */
  sentAt: Date | null;
  /**
   * The Authentication-Results the MTA wrote on receiving it, never one the message carried (which anyone can
   * write). Empty when there is none.
   */
  authenticationResults: string;
  /** Its text, capped at MAX_TEXT_CHARACTERS. */
  text: string;
  /** Its subject, empty when it has none (#1099: an Exchange keeps it). */
  subject: string;
  /** The Message-IDs its In-Reply-To and References name (#1099: to find an Exchange's thread), never kept. */
  threadIds: string[];
  /**
   * The address of the message it forwards, in lower case: the From of a message forwarded as an attachment, else the
   * first forwarded header block of its text; null when it forwards none that names an address. Written by whoever
   * forwarded it: never authenticated.
   */
  forwardedFrom: string | null;
}

/** The line that opens a message forwarded as an attachment, in the text kept. */
export const FORWARDED_MESSAGE_MARK = "---------- Message transféré ----------";

/** How many messages forwarded as attachments are read: an alert is one. */
const MAX_FORWARDED_MESSAGES = 3;

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

const addressesOf = (value: string | null): string[] =>
  (value ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter((address) => address.includes("@"));

function dateOf(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The Message-IDs In-Reply-To and References name, each `<…>`, once. */
function threadIdsOf(...headers: (string | undefined)[]): string[] {
  return [...new Set(headers.flatMap((header) => header?.match(/<[^<>\s]+>/g) ?? []))];
}

/** A header line of a forward's header block: its name (De, From, Objet, Subject…) and its value. */
const HEADER_LINE = /^\*{0,2}(de|from|exp[ée]diteur|objet|subject|date|envoy[ée]|sent|à|to|cc|répondre à|reply-to)\s*:\*{0,2}\s*(.*)$/i;
const SENDER_HEADERS = new Set(["de", "from", "expéditeur", "expediteur"]);
const ADDRESS = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/**
 * The address the first forwarded header block of a text names as its sender: a « De : » or « From: » line with an
 * address, next to another header line (Objet, Subject, Date, Envoyé, Sent, À, To) among its neighbours. Null when none.
 */
export function forwardedSenderOf(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const header = HEADER_LINE.exec(line);
    if (!header || !SENDER_HEADERS.has(header[1]!.toLowerCase())) continue;
    const address = ADDRESS.exec(header[2]!)?.[0];
    if (!address) continue;
    const neighbours = [...lines.slice(Math.max(0, index - 4), index), ...lines.slice(index + 1, index + 5)];
    if (neighbours.some((other) => { const name = HEADER_LINE.exec(other)?.[1]?.toLowerCase(); return name !== undefined && !SENDER_HEADERS.has(name); })) {
      return address.toLowerCase();
    }
  }
  return null;
}

type ParsedEmail = Awaited<ReturnType<typeof PostalMime.parse>>;

/** The messages forwarded as attachments (`message/rfc822`), parsed; one that does not read, or names no sender, is skipped. */
async function forwardedMessagesOf(message: ParsedEmail): Promise<ParsedEmail[]> {
  const attached = message.attachments.filter((attachment) => attachment.mimeType.toLowerCase() === "message/rfc822" && attachment.content instanceof ArrayBuffer);
  const parsed = await Promise.all(
    attached.slice(0, MAX_FORWARDED_MESSAGES).map((attachment) =>
      PostalMime.parse(attachment.content as ArrayBuffer, { attachmentEncoding: "arraybuffer", forceRfc822Attachments: true }).catch(() => null),
    ),
  );
  return parsed.filter((forwarded): forwarded is ParsedEmail => Boolean(forwarded?.from?.address));
}

/** A forwarded message as an inline forward writes it: its header block, then its text. */
function forwardedTextOf(forwarded: ParsedEmail): string {
  const sender = forwarded.from!;
  const from = sender.name ? `${sender.name} <${sender.address}>` : `<${sender.address}>`;
  return [
    FORWARDED_MESSAGE_MARK,
    `De : ${from}`,
    ...(forwarded.date ? [`Date : ${forwarded.date}`] : []),
    `Objet : ${forwarded.subject?.trim() ?? ""}`,
    "",
    inboundTextOf({ html: forwarded.html, text: forwarded.text }),
  ].join("\n");
}

/** One email as the MTA posts it (raw message, envelope and stamp in headers); null when its message names no sender. */
export async function readInboundEmail(request: Request): Promise<InboundEmail | null> {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength === 0) return null;
  // A message forwarded as an attachment stays an attachment here, whatever its disposition, to be read below.
  const message = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer", forceRfc822Attachments: true }).catch(() => null);
  const from = message?.from?.address?.trim().toLowerCase();
  if (!message || !from) return null;
  const forwarded = await forwardedMessagesOf(message);
  const text = [inboundTextOf({ html: message.html, text: message.text }), ...forwarded.map(forwardedTextOf)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARACTERS);
  const forwardedFrom = forwarded[0]?.from?.address?.trim().toLowerCase() || forwardedSenderOf(text);
  const envelope = addressesOf(request.headers.get(ENVELOPE_TO_HEADER));
  const messageId =
    message.messageId?.trim() || `<${createHash("sha256").update(`${from}\n${message.date ?? ""}\n${message.subject ?? ""}\n${text}`, "utf8").digest("hex")}@email-intake>`;
  return {
    messageId,
    from,
    recipients: envelope.length > 0 ? envelope : (message.to ?? []).flatMap((to) => addressesOf(to.address ?? null)),
    sentAt: dateOf(message.date),
    authenticationResults: request.headers.get(AUTHENTICATION_RESULTS_HEADER)?.trim() ?? "",
    text,
    subject: message.subject?.trim() ?? "",
    threadIds: threadIdsOf(message.inReplyTo, message.references),
    forwardedFrom: forwardedFrom && forwardedFrom !== from ? forwardedFrom : null,
  };
}
