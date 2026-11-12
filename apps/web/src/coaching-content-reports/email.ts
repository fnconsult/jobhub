import { createI18n } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
import type { ReportNotice } from "./index";
export function contentReportEmail(notice: ReportNotice, baseURL: string) {
  const { t } = createI18n(notice.locale),
    decision = notice.kind === "decision";
  return renderEmail({
    language: notice.locale,
    subject: t(decision ? "contentReport.email.decision" : "contentReport.email.receipt"),
    title: t(decision ? "contentReport.email.decision" : "contentReport.email.receipt"),
    body: [
      t("contentReport.email.reference", { id: notice.reportId, coach: notice.coachName }),
      ...(decision
        ? [t(`contentReport.outcomes.${notice.outcome ?? "keep"}`), notice.reason ?? "", t("contentReport.email.human")]
        : [t("contentReport.email.received")]),
    ],
    footer: { reason: t("contentReport.email.footer"), link: { label: t("contentReport.help"), url: new URL("/aide", baseURL).toString() } },
  });
}
