import { createI18n } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
import type { CoachPageVersion } from "./index";
export function coachPageDecisionEmail(record: CoachPageVersion, baseURL: string) {
  const { t } = createI18n(record.locale),
    approved = record.state === "approved";
  return renderEmail({
    language: record.locale,
    subject: t(approved ? "coachPage.email.approved" : "coachPage.email.refused"),
    title: t(approved ? "coachPage.email.approved" : "coachPage.email.refused"),
    body: approved ? [t("coachPage.email.visible")] : [t("coachPage.email.reason"), record.reason ?? ""],
    footer: { reason: t("coachPage.email.footer"), link: { label: t("coachSpaceV2.pages.profil"), url: new URL("/espace-coach/profil", baseURL).toString() } },
  });
}
