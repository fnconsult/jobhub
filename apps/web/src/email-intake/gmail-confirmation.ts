/**
 * Gmail's forwarding confirmation (#451): when a Candidate adds their Forwarding address in Gmail, Google sends a code
 * and a link to that address, and the setup wizard shows them. Google documents neither the code's length nor its
 * characters (docs/research/issue-451.md), so any run of digits after « code » counts, else the subject's « (#123) »;
 * the link, on Google's own hosts only, is kept too as a fallback.
 *
 *   gmailConfirmationOf("Code de confirmation : 123456789 … https://mail-settings.google.com/mail/vf-…")
 *   // { code: "123456789", link: "https://mail-settings.google.com/mail/vf-…" }
 */

export interface GmailConfirmation {
  /** The confirmation code to type in Gmail, or null when none reads. */
  code: string | null;
  /** The link that confirms it in one click, on a Google host, or null. */
  link: string | null;
}

/** « code » in any of Gmail's languages (code, Bestätigungscode, código…), then a run of digits close after it. */
const CODE = /code[^\d\n]{0,40}?(\d{4,})/i;
/** The subject's « (#123456789) Gmail Forwarding Confirmation ». */
const SUBJECT_NUMBER = /\(#(\d{4,})\)/;
/** A link on mail.google.com or mail-settings.google.com, up to a space or the « > » the HTML part wrote after it. */
const LINK = /https:\/\/(?:mail|mail-settings)\.google\.com\/[^\s<>"']+/i;

export function gmailConfirmationOf(text: string): GmailConfirmation {
  return {
    code: CODE.exec(text)?.[1] ?? SUBJECT_NUMBER.exec(text)?.[1] ?? null,
    link: LINK.exec(text)?.[0] ?? null,
  };
}
