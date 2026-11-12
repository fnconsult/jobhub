import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail } from "../emails";
export function fiscalCopyEmail(notice: { locale: Locale; year: number; reportId: string; sellerId: string }, baseURL: string) {
  const { t } = createI18n(notice.locale);
  return renderEmail({
    language: notice.locale,
    subject: t("coachTax.copyTitle", { year: notice.year }),
    title: t("coachTax.copyTitle", { year: notice.year }),
    body: [
      t("coachTax.preparedNotFiled"),
      { action: { label: t("coachTax.downloadCopy"), url: new URL(`/api/account/coaching/tax/${notice.reportId}/${notice.sellerId}`, baseURL).toString() } },
    ],
    footer: { reason: t("coachTax.emailReason") },
  });
}
