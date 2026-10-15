/**
 * The body of a Cover Letter: from its salutation to its closing, in plain text.
 *
 * The sender block, the recipient's address, the place and date, the subject
 * and the signature are not part of it: the Application export adds them from
 * the Master CV's contact details, once (#162). So whatever the AI Coach (or a
 * paste) puts around the letter is left out, and so are Markdown markers and
 * `[…]` placeholders the Candidate would otherwise have to fill in.
 */

/** Whom the letter is from: their name is the signature to leave out. */
export interface Signer {
  fullName: string;
}

/** A `[…]` to fill in, e.g. `[Adresse]`, `[Email] | [Téléphone]`, `[Date]`. */
const PLACEHOLDER = /\[[^\]\n]{1,80}\]/;

/** How a letter opens: "Madame, Monsieur,", "Monsieur le Directeur,", "Dear Hiring Manager,", … */
const SALUTATION = /^(madame|monsieur|mesdames|messieurs|cher|chère|bonjour|dear|hello|to whom it may concern)\b.{0,60}$/i;

/** Lines before the salutation or after the closing that belong to the letter's frame, not its body. */
const FRAME = /^((objet|subject|re|p\.\s?j\.?|pièces? jointes?|enclosures?)\s*:|(à|a) l'attention\b|attn\b)/i;
const CONTACT = /\S+@\S+\.\S+|\+?\d[\d .-]{7,}\d/;

/** A line without Markdown: no heading marks, emphasis, inline code, quotes or link syntax. */
function plain(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/^(\s*)[*+]\s+/, "$1- ")
    .replace(/\[([^\]\n]+)\]\((?:[^)\s]+)\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\p{L}\p{N}*])\*(?!\s)([^*\n]+?)\*(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)_(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/\*\*|__/g, "")
    .trimEnd();
}

const wordsIn = (text: string) => text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

const comparable = (text: string) =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s.,;:!]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

/** `text` with any `[…]` left in a sentence taken out, and the spaces around it tidied. */
const withoutPlaceholders = (line: string) =>
  line
    .replace(new RegExp(PLACEHOLDER, "g"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?)])/g, "$1")
    .trim();

/** Whether `line` is part of the letter's frame (sender block, address, date, subject, signature) rather than its body. */
function isFrame(line: string, signer: Signer): boolean {
  const text = line.trim();
  if (!text) return true;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) return true;
  if (signer.fullName && comparable(text) === comparable(signer.fullName)) return true;
  // A short line with a `[…]` in it is a sender or recipient line to fill in ("Lyon, le [Date]"); a sentence is not.
  if (PLACEHOLDER.test(text) && wordsIn(withoutPlaceholders(text)) < 5) return true;
  return FRAME.test(text) || (text.length <= 100 && CONTACT.test(text));
}

/** The body of the Cover Letter `text`, signed by `signer`. Paragraphs are separated by one blank line. */
export function coverLetterBody(text: string, signer: Signer): string {
  let lines = text.replace(/\r\n?/g, "\n").split("\n").map(plain);

  const frame = (line: string) => isFrame(line, signer);
  const salutation = lines.findIndex((line) => SALUTATION.test(line.trim()));
  const start = salutation >= 0 ? salutation : lines.findIndex((line) => !frame(line));
  const end = lines.length - 1 - [...lines].reverse().findIndex((line) => !frame(line));
  lines = start >= 0 && end < lines.length && end >= start ? lines.slice(start, end + 1) : [];

  return lines
    .map((line) => (line.trim() ? withoutPlaceholders(line) : ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
