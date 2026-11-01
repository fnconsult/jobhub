import type { LegalTextVersion } from "@jobhub/help";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";
import { writtenDay } from "../public-pages/days";

/**
 * The notice of a substantial Legal Text Version (#547), in `language`: the text it changes, its effective date, its
 * line in the version history, what happens then (the CGU are accepted at the next sign-in, #510; the CGV at the next
 * purchase; the privacy policy is never accepted), the button to the new version and, in the footer, the version
 * history. A service email: it says why it came even without a marketing opt-in, and it has nothing to switch off.
 * Like every email, no image and no tracked link (apps/web/src/emails).
 */
export function legalTextNoticeEmail({ version, versionUrl, historyUrl }: { version: Pick<LegalTextVersion, "text" | "effective" | "summary">; versionUrl: string; historyUrl: string }, language: Locale): RenderedEmail {
  const { t } = createI18n(language);
  const text = t(`legal.texts.${version.text}`);
  const date = writtenDay(version.effective, language);
  // The legal notice is never noticed (NOTICED_LEGAL_TEXTS): nothing follows from it.
  const then = version.text === "mentions-legales" ? [] : [t(`legalTextNotice.email.then.${version.text}`, { date })];
  return renderEmail({
    language,
    subject: t("legalTextNotice.email.subject", { text, date }),
    title: t("legalTextNotice.email.title", { text }),
    body: [
      t("legalTextNotice.email.intro", { text, date }),
      { card: { title: text, details: [t("legalTextNotice.email.effective", { date }), t("legalTextNotice.email.summary", { summary: version.summary })], url: versionUrl } },
      ...then,
      { action: { label: t("legalTextNotice.email.read"), url: versionUrl } },
    ],
    footer: { reason: t("legalTextNotice.email.reason"), link: { label: t("legalTextNotice.email.history"), url: historyUrl } },
  });
}
