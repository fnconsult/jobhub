import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/**
 * The notice of a Follow-up waiting on an Application (`followUp`), or of one abandoned after the last Follow-up
 * went unanswered (`abandoned`): the button opens the Application; the footer links to the Follow-up Delays.
 */
export function followUpEmail(
  kind: "followUp" | "abandoned",
  { jobTitle: title, applicationUrl, settingsUrl }: { jobTitle: string; applicationUrl: string; settingsUrl: string },
  language: Locale,
): RenderedEmail {
  const { t } = createI18n(language);
  const key = kind === "followUp" ? "followUps.email" : "followUps.abandonEmail";
  return renderEmail({
    language,
    subject: t(`${key}.subject`, { title }),
    title: t(`${key}.title`),
    body: [t(`${key}.body`, { title }), { action: { label: t(`${key}.action`), url: applicationUrl } }],
    footer: { reason: t("followUps.emailReason"), link: { label: t("followUps.emailSettings"), url: settingsUrl } },
  });
}
