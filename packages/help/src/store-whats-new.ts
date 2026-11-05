import type { ReleaseNote } from "./release-notes";
import type { HelpLocale } from "./types";

/** Google Play's limit on « Nouveautés » per language; the App Store's (4,000) is wider, so one text fits both. */
export const STORE_WHATS_NEW_LIMIT = 500;

const WORDING: Record<HelpLocale, { nothingVisible: string; more: string }> = {
  fr: { nothingVisible: "Corrections et améliorations.", more: "• Et d'autres nouveautés dans l'app, rubrique Nouveautés." },
  en: { nothingVisible: "Fixes and improvements.", more: "• And more in the app, under What's new." },
};

/**
 * The stores' « Nouveautés » (« What's new ») for a Version of the app (#704, ADR-0063): taken from the same Release
 * Note as Nouveautés, in its language. Its title, then one line per change: the change's bold lead when it has one
 * (« **L'app Jobbbox** : … » gives « L'app Jobbbox »), its whole text otherwise, in plain text (the stores read no
 * Markdown). Cut at a whole change to fit STORE_WHATS_NEW_LIMIT. A Version with no Release Note, nothing a Candidate
 * can see, says fixes and improvements.
 */
export function storeWhatsNew(note: ReleaseNote | null, locale: HelpLocale): string {
  const wording = WORDING[locale];
  if (!note) return wording.nothingVisible;
  const lines = [plain(note.title), ""];
  const changes = note.changes.map((change) => `• ${plain(lead(change.text))}`);
  for (const [index, change] of changes.entries()) {
    const last = index === changes.length - 1;
    const room = STORE_WHATS_NEW_LIMIT - [...lines, change, ...(last ? [] : [wording.more])].join("\n").length;
    if (room < 0) {
      lines.push(wording.more);
      break;
    }
    lines.push(change);
  }
  return lines.join("\n").trim();
}

/** A change's bold lead (« **L'app Jobbbox** : … »), or its whole text. */
function lead(text: string): string {
  return /^\*\*(.+?)\*\*/.exec(text.trim())?.[1] ?? text;
}

/** Markdown's emphasis, code and links, as plain text. */
function plain(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w])[*_](.+?)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
