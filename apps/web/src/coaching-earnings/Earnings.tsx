import { Amount } from "@/design/Amount";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Status, type StatusTone } from "@/design/Pill";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import { getServerT } from "@/i18n/server";
import { coachingTime } from "@jobhub/shared/coaching-time";
import type { EarningsStatement, EarningsPayout } from "./index";
const MONTH = "mois",
  PDF = "/api/coaching/earnings";
/** A payout's state, in its tone: paid, to reconcile or check with the support, or under way. */
const PAYOUT_TONE: Record<EarningsPayout["state"], StatusTone> = {
  pending: "neutral",
  paid: "success",
  failed: "danger",
  needs_review: "warn",
  cancelling: "neutral",
  cancelled: "neutral",
};
/** Stored in cents, shown in the currency's units. */
const money = (amount: number, currency: string) => <Amount value={amount / 100} currency={currency.toUpperCase()} />;
export async function Earnings({ statement, path, locale, timeZone }: { statement: EarningsStatement; path: string; locale: "fr" | "en"; timeZone: string }) {
  const t = await getServerT();
  const pdf = `${PDF}/${statement.seller.id}/pdf?${new URLSearchParams({ mois: statement.month, lang: locale })}`;
  return (
    <>
      <Card title={t("coachEarnings.title")}>
        <div className="stack">
          <p>{t("coachEarnings.monthBasis")}</p>
          <form className="stack" method="get" action={path}>
            <Field label={t("coachEarnings.month")}>
              <TextInput type="month" name={MONTH} defaultValue={statement.month} required />
            </Field>
            <button className={buttonClass({ variant: "primary" })} type="submit">
              {t("coachEarnings.show")}
            </button>
          </form>
          <a className={buttonClass()} href={pdf}>
            {t("coachEarnings.pdf")}
          </a>
          <p>{t("coachEarnings.heldCount", { count: statement.sessionsHeld })}</p>
          {statement.beneficiaries.length ? (
            <div>
              <h3>{t("coachEarnings.beneficiaries")}</h3>
              {statement.beneficiaries.map((payee, index) => (
                <p key={index}>
                  {payee.name} · {payee.status} · {t("coachingOffers.siret", { siret: payee.siret })}
                </p>
              ))}
            </div>
          ) : null}
          {!statement.currencies.some((row) => row.payments > 0) ? <p>{t("coachEarnings.empty")}</p> : null}
        </div>
      </Card>
      {statement.currencies.map((summary) => (
        <Card key={summary.currency} title={t("coachEarnings.currency", { currency: summary.currency.toUpperCase() })} headingLevel={3}>
          <div className="stack">
            <Properties>
              <Property term={t("coachEarnings.collected")}>{money(summary.collected, summary.currency)}</Property>
              <Property term={t("coachEarnings.commission")}>{money(summary.commission, summary.currency)}</Property>
              <Property term={t("coachEarnings.refunds")}>{money(summary.refunded, summary.currency)}</Property>
              <Property term={t("coachEarnings.refundedCommission")}>{money(summary.refundedCommission, summary.currency)}</Property>
              <Property term={t("coachEarnings.fees")}>{money(summary.processingFees, summary.currency)}</Property>
              <Property term={t("coachEarnings.withheld")}>{money(summary.withheld, summary.currency)}</Property>
              <Property term={t("coachEarnings.net")}>{money(summary.net, summary.currency)}</Property>
              <Property term={t("coachEarnings.outstanding")}>{money(summary.outstanding, summary.currency)}</Property>
            </Properties>
            {summary.nextPayoutAt ? <p>{t("coachEarnings.expected", { date: coachingTime(summary.nextPayoutAt, locale, timeZone) })}</p> : null}
            <p>{t("coachEarnings.netBasis")}</p>
          </div>
        </Card>
      ))}
      <Card title={t("coachEarnings.offers")}>
        {!statement.offers.length ? (
          <p>{t("coachEarnings.empty")}</p>
        ) : (
          <Table
            label={t("coachEarnings.offers")}
            rows={statement.offers}
            rowKey={(offer) => offer.key}
            columns={[
              {
                header: t("coachEarnings.offer"),
                rowHeader: true,
                cell: (offer) => (
                  <>
                    {offer.coachName}
                    <br />
                    {t("humanCoaches.sessionDuration", { count: offer.durationMinutes })}
                    <br />
                    {t("coachingOffers.soldBy", { name: offer.seller.name })}
                  </>
                ),
              },
              { header: t("coachEarnings.heldSessions"), numeric: true, cell: (offer) => offer.sessionsHeld },
              { header: t("coachEarnings.collected"), numeric: true, cell: (offer) => money(offer.collected, offer.currency) },
              { header: t("coachEarnings.commission"), numeric: true, cell: (offer) => money(offer.commission, offer.currency) },
              { header: t("coachEarnings.refunds"), numeric: true, cell: (offer) => money(offer.refunded, offer.currency) },
              { header: t("coachEarnings.net"), numeric: true, cell: (offer) => money(offer.net, offer.currency) },
            ]}
          />
        )}
      </Card>
      <Card title={t("coachEarnings.payouts")}>
        <div className="stack">
          <p>{t("coachEarnings.payoutBasis")}</p>
          {!statement.payouts.length ? (
            <p>{t("coachEarnings.noPayout")}</p>
          ) : (
            <ul className="stack">
              {statement.payouts.map((payout) => (
                <li key={payout.id}>
                  <p>
                    <strong>{money(payout.amount, payout.currency)}</strong> · {coachingTime(payout.paidAt ?? payout.createdAt, locale, timeZone)}
                  </p>
                  <p>
                    <Status tone={PAYOUT_TONE[payout.state]}>{t(`coachEarnings.states.${payout.state}`)}</Status>
                  </p>
                  {payout.state === "needs_review" || payout.state === "failed" ? <p>{t("coachEarnings.support")}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
