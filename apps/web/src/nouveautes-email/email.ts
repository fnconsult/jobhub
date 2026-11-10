import type { ReleaseNote } from "@jobhub/help";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/** A Release Note's short Markdown as plain words: `**bold**`, `*italic*`, `` `code` `` and `[label](url)` lose their marks. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * The Nouveautés email (#566), in `language`: the Release Note's title, its introduction and its « Nouveau » lines, the
 * button to its page on Nouveautés and, in the footer, the unsubscribe link (the List-Unsubscribe header is the mailer
 * call's). Like every email, no image and no tracked link: the Release Note's own image and links stay on its page.
 */
export function nouveautesEmail(
  {
    note,
    noteUrl,
    unsubscribeUrl,
    preferredName,
  }: { note: Pick<ReleaseNote, "version" | "title" | "intro" | "changes">; noteUrl: string; unsubscribeUrl: string; preferredName?: string | null },
  language: Locale,
): RenderedEmail {
  const { t } = createI18n(language);
  const lines = note.changes.filter((change) => change.kind === "new").map((change) => `• ${plainText(change.text)}`);
  return renderEmail({
    language,
    greetingName: preferredName,
    subject: t("nouveautesEmail.email.subject", { title: note.title }),
    title: note.title,
    body: [
      plainText(note.intro),
      ...(lines.length ? [`${t("nouveautes.changes.new")}\n${lines.join("\n")}`] : []),
      { action: { label: t("nouveautesEmail.email.read", { version: note.version }), url: noteUrl } },
    ],
    footer: { reason: t("nouveautesEmail.email.reason"), link: { label: t("nouveautesEmail.email.unsubscribe"), url: unsubscribeUrl } },
  });
}
