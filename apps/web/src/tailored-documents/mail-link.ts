/**
 * The link that opens an Outreach Message in the Candidate's own mail client,
 * ready for them to send (addressed to its Enriched Contact, if any): Jobbbox
 * sends nothing (ADR-0005). Safe to use in the browser.
 */
export function mailLink({ to = "", subject, text }: { to?: string; subject: string; text: string }): string {
  // RFC 6068: line breaks in a body are CRLF; the "@" of an address needs no escaping.
  const fields = [subject ? `subject=${encodeURIComponent(subject)}` : "", `body=${encodeURIComponent(text.replace(/\r?\n/g, "\r\n"))}`];
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${fields.filter(Boolean).join("&")}`;
}
