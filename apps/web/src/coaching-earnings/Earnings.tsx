import { Field, TextInput } from "@/design/Field";
import { getServerT } from "@/i18n/server";
import { coachingTime } from "@jobhub/shared/coaching-time";
import type { EarningsStatement, EarningsOffer } from "./index";
import "./earnings.css";
const MONTH = "mois",
  PDF = "/api/coaching/earnings";
export async function Earnings({ statement, path, locale, timeZone }: { statement: EarningsStatement; path: string; locale: "fr" | "en"; timeZone: string }) {
  const t = await getServerT(),
    money = (amount: number, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount / 100);
  const fields = (offer: EarningsOffer) => [
    [t("coachEarnings.heldSessions"), String(offer.sessionsHeld)],
    [t("coachEarnings.collected"), money(offer.collected, offer.currency)],
    [t("coachEarnings.commission"), money(offer.commission, offer.currency)],
    [t("coachEarnings.refunds"), money(offer.refunded, offer.currency)],
    [t("coachEarnings.net"), money(offer.net, offer.currency)],
  ];
  const pdf = `${PDF}/${statement.seller.id}/pdf?${new URLSearchParams({ mois: statement.month, lang: locale })}`;
  return (
    <>
      <section className="coach-space-card stack">
        <h2>{t("coachEarnings.title")}</h2>
        <p>{t("coachEarnings.monthBasis")}</p>
        <form className="earnings-filter" method="get" action={path}>
          <Field label={t("coachEarnings.month")}>
            <TextInput type="month" name={MONTH} defaultValue={statement.month} required />
          </Field>
          <button className="button" type="submit">
            {t("coachEarnings.show")}
          </button>
        </form>
        <a className="button" href={pdf}>
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
      </section>
      {statement.currencies.map((summary) => (
        <section key={summary.currency} className="coach-space-card stack">
          <h3>{t("coachEarnings.currency", { currency: summary.currency.toUpperCase() })}</h3>
          <dl className="earnings-metrics">
            {[
              [t("coachEarnings.collected"), money(summary.collected, summary.currency)],
              [t("coachEarnings.commission"), money(summary.commission, summary.currency)],
              [t("coachEarnings.refunds"), money(summary.refunded, summary.currency)],
              [t("coachEarnings.refundedCommission"), money(summary.refundedCommission, summary.currency)],
              [t("coachEarnings.fees"), money(summary.processingFees, summary.currency)],
              [t("coachEarnings.withheld"), money(summary.withheld, summary.currency)],
              [t("coachEarnings.net"), money(summary.net, summary.currency)],
              [t("coachEarnings.outstanding"), money(summary.outstanding, summary.currency)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {summary.nextPayoutAt ? <p>{t("coachEarnings.expected", { date: coachingTime(summary.nextPayoutAt, locale, timeZone) })}</p> : null}
          <p>{t("coachEarnings.netBasis")}</p>
        </section>
      ))}
      <section className="coach-space-card stack">
        <h2>{t("coachEarnings.offers")}</h2>
        {!statement.offers.length ? (
          <p>{t("coachEarnings.empty")}</p>
        ) : (
          <>
            <table className="earnings-table">
              <thead>
                <tr>
                  {[
                    t("coachEarnings.offer"),
                    t("coachEarnings.heldSessions"),
                    t("coachEarnings.collected"),
                    t("coachEarnings.commission"),
                    t("coachEarnings.refunds"),
                    t("coachEarnings.net"),
                  ].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.offers.map((offer) => (
                  <tr key={offer.key}>
                    <th scope="row">
                      {offer.coachName}
                      <br />
                      {t("humanCoaches.sessionDuration", { count: offer.durationMinutes })}
                      <br />
                      {t("coachingOffers.soldBy", { name: offer.seller.name })}
                    </th>
                    {fields(offer).map(([label, value]) => (
                      <td key={label}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="earnings-list">
              {statement.offers.map((offer) => (
                <li key={offer.key} className="stack">
                  <h3>{offer.coachName}</h3>
                  <p>
                    {t("humanCoaches.sessionDuration", { count: offer.durationMinutes })} · {t("coachingOffers.soldBy", { name: offer.seller.name })}
                  </p>
                  <dl className="earnings-detail">
                    {fields(offer).map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="coach-space-card stack">
        <h2>{t("coachEarnings.payouts")}</h2>
        <p>{t("coachEarnings.payoutBasis")}</p>
        {!statement.payouts.length ? (
          <p>{t("coachEarnings.noPayout")}</p>
        ) : (
          <ul className="earnings-list earnings-payouts">
            {statement.payouts.map((payout) => (
              <li className="stack" key={payout.id}>
                <strong>{money(payout.amount, payout.currency)}</strong>
                <span>{t(`coachEarnings.states.${payout.state}`)}</span>
                <span>{coachingTime(payout.paidAt ?? payout.createdAt, locale, timeZone)}</span>
                {payout.state === "needs_review" || payout.state === "failed" ? <p>{t("coachEarnings.support")}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
