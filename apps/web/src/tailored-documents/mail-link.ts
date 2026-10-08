/**
 * The link that opens an Outreach Message in the Candidate's own mail client,
 * ready for them to address and send: Jobbbox sends nothing (ADR-0005).
 * Safe to use in the browser.
 */
export function mailLink({ subject, text }: { subject: string; text: string }): string {
  // RFC 6068: line breaks in a body are CRLF.
  const fields = [subject ? `subject=${encodeURIComponent(subject)}` : "", `body=${encodeURIComponent(text.replace(/\r?\n/g, "\r\n"))}`];
  return `mailto:?${fields.filter(Boolean).join("&")}`;
}
