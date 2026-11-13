import { createI18n } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
import type { Enrolment } from "./index";
/** The human decision's reason is rendered verbatim as text and escaped by the shared email layout. */
export function coachEnrolmentDecisionEmail(record: Enrolment, baseURL: string) {
  const { t } = createI18n(record.locale);
  const approved = record.state === "approved";
  return renderEmail({
    language: record.locale,
    subject: t(approved ? "coachEnrolment.email.approved" : "coachEnrolment.email.refused"),
    title: t(approved ? "coachEnrolment.email.approved" : "coachEnrolment.email.refused"),
    body: approved
      ? [t("coachEnrolment.email.next"), { action: { label: t("coachEnrolment.contract"), url: new URL("/espace-coach/contrat", baseURL).toString() } }]
      : [t("coachEnrolment.email.reason"), record.reason ?? ""],
    footer: { reason: t("coachEnrolment.email.footer") },
  });
}
