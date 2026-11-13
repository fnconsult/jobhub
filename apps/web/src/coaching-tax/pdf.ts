import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { Block } from "../export/layout";
import { renderPdf } from "../export/pdf";
import { TEMPLATE_STYLES } from "../export/templates";
import type { AnnualSeller } from "./xml";
export async function fiscalCopyPdf(copy: { year: number; createdAt: string; seller: AnnualSeller; supersededAt?: Date | null }, locale: Locale) {
  const { t } = createI18n(locale),
    x = copy.seller.identity,
    money = (cents: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(cents / 100);
  const blocks: Block[] = [
    { kind: "name", text: t("coachTax.copyTitle", { year: copy.year }) },
    { kind: "text", text: t("coachTax.preparedNotFiled") },
    { kind: "contact", text: x.legalName },
    { kind: "text", text: x.kind === "individual" ? `${x.firstName} ${x.lastName} · ${x.birthDate}` : x.legalName },
    { kind: "text", text: `${x.street}, ${x.postalCode} ${x.city}, ${x.addressCountry}` },
    { kind: "text", text: `${t("coachTax.tin")}: ${x.tin} (${x.tinCountry})` },
    { kind: "text", text: `${t("coachTax.iban")}: ${x.iban} · ${x.accountHolder}` },
  ];
  if (copy.supersededAt) blocks.push({ kind: "text", text: t("coachTax.superseded") });
  for (const q of copy.seller.quarters)
    blocks.push(
      { kind: "heading", text: t("coachTax.quarter", { number: q.quarter }) },
      ...(
        [
          [t("coachTax.consideration"), q.consideration],
          [t("coachTax.fees"), q.fees],
          [t("coachTax.taxes"), q.taxes],
          [t("coachTax.payouts"), q.bankPayouts],
        ] as const
      ).map(([label, cents]) => ({ kind: "text" as const, text: `${label}: ${money(cents)}` })),
      { kind: "text", text: t("coachTax.activities", { count: q.activities }) },
    );
  blocks.push({ kind: "text", text: t("coachTax.rounding") }, { kind: "text", text: t("coachTax.basis") });
  const filename = `dac7-${copy.year}.pdf`;
  return { filename, bytes: await renderPdf(blocks, TEMPLATE_STYLES.modern, filename) };
}
