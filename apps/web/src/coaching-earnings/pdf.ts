import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { coachingTime } from "@jobhub/shared/coaching-time";
import type { Block } from "../export/layout";
import { renderPdf } from "../export/pdf";
import { TEMPLATE_STYLES } from "../export/templates";
import type { EarningsStatement } from "./index";
/** A statement, never an agent-authored tax invoice or self-billing mandate. */
export function earningsPdfBlocks(statement: EarningsStatement, locale: Locale, timeZone: string): Block[] {
  const { t } = createI18n(locale),
    money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
  const blocks: Block[] = [
    { kind: "name", text: t("coachEarnings.statementTitle", { month: statement.month }) },
    { kind: "contact", text: statement.seller.name },
    { kind: "contact", text: `${statement.seller.status} · ${t("coachingOffers.siret", { siret: statement.seller.siret })}` },
    { kind: "text", text: t("coachEarnings.generated", { date: coachingTime(statement.generatedAt, locale, timeZone) }) },
    { kind: "text", text: t("coachEarnings.monthBasis") },
    { kind: "text", text: t("coachEarnings.heldCount", { count: statement.sessionsHeld }) },
  ];
  for (const payee of statement.beneficiaries)
    blocks.push({
      kind: "text",
      text: `${t("coachEarnings.beneficiaries")} : ${payee.name} · ${payee.status} · ${t("coachingOffers.siret", { siret: payee.siret })}`,
    });
  for (const row of statement.currencies) {
    blocks.push({ kind: "heading", text: t("coachEarnings.currency", { currency: row.currency.toUpperCase() }) });
    for (const [label, value] of [
      [t("coachEarnings.collected"), row.collected],
      [t("coachEarnings.commission"), row.commission],
      [t("coachEarnings.refunds"), row.refunded],
      [t("coachEarnings.refundedCommission"), row.refundedCommission],
      [t("coachEarnings.fees"), row.processingFees],
      [t("coachEarnings.withheld"), row.withheld],
      [t("coachEarnings.net"), row.net],
      [t("coachEarnings.outstanding"), row.outstanding],
    ] as const)
      blocks.push({ kind: "text", text: `${label} : ${money(value, row.currency)}` });
    if (row.nextPayoutAt) blocks.push({ kind: "text", text: t("coachEarnings.expected", { date: coachingTime(row.nextPayoutAt, locale, timeZone) }) });
  }
  blocks.push({ kind: "heading", text: t("coachEarnings.offers") });
  for (const row of statement.offers)
    blocks.push(
      { kind: "entry", text: `${row.coachName} · ${t("humanCoaches.sessionDuration", { count: row.durationMinutes })}` },
      { kind: "text", text: t("coachingOffers.soldBy", { name: row.seller.name }) },
      { kind: "text", text: t("coachEarnings.heldCount", { count: row.sessionsHeld }) },
      {
        kind: "text",
        text: `${t("coachEarnings.collected")} : ${money(row.collected, row.currency)} · ${t("coachEarnings.commission")} : ${money(row.commission, row.currency)} · ${t("coachEarnings.refunds")} : ${money(row.refunded, row.currency)} · ${t("coachEarnings.net")} : ${money(row.net, row.currency)}`,
      },
    );
  blocks.push({ kind: "heading", text: t("coachEarnings.payouts") }, { kind: "text", text: t("coachEarnings.payoutBasis") });
  for (const row of statement.payouts)
    blocks.push({
      kind: "text",
      text: `${money(row.amount, row.currency)} · ${t(`coachEarnings.states.${row.state}`)} · ${coachingTime(row.paidAt ?? row.createdAt, locale, timeZone)}`,
    });
  blocks.push({ kind: "gap" }, { kind: "text", text: t("coachEarnings.netBasis") });
  return blocks;
}
export async function earningsPdf(statement: EarningsStatement, locale: Locale, timeZone: string) {
  const fileName = `${locale === "fr" ? "releve-revenus" : "earnings-statement"}-${statement.month}.pdf`;
  return { fileName, bytes: await renderPdf(earningsPdfBlocks(statement, locale, timeZone), TEMPLATE_STYLES.modern, fileName) };
}
