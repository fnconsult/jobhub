import { FREE_PLAN, LIMITED_QUOTAS, MONTHLY_QUOTAS, type PlanQuotas } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { currentPlanLabel } from "@/billing/current-plan";
import { paymentFailedNotice } from "@/billing/payment-failed-notice";
import { planPriceLabel } from "@/billing/plan-price";
import { planQuotaValue } from "@/billing/quota-labels";
import { getBilling } from "@/billing/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { PaymentFailedNotice } from "@/components/PaymentFailedNotice";
import { RefreshUntilPlanConfirmed } from "@/components/RefreshUntilPlanConfirmed";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("billing.page.title")} · ${t("app.name")}` };
}

const QUOTA_ROWS = [...LIMITED_QUOTAS, "jobDigest"] as const satisfies readonly (keyof PlanQuotas)[];

/**
 * The Candidate's Plan, this month's usage, the offered Plans side by side in rank order with their
 * prices, and the way to Stripe (and their invoices there). A hidden Plan is not compared, even the Candidate's.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { checkout, error } = await searchParams;
  const billing = getBilling();
  const [{ plan, stripeStatus, endsAt, quotas, usedThisMonth }, plans, allQuotas, prices, hasInvoices] = await Promise.all([
    billing.entitlements(candidate.id),
    billing.plans(),
    billing.planQuotas(),
    billing.planPrices(),
    billing.hasInvoices(candidate.id),
  ]);
  const offered = plans.filter((each) => each.status === "offered");
  const planName = plans.find((each) => each.key === plan)?.name ?? { fr: plan, en: plan };
  const paymentFailed = paymentFailedNotice(stripeStatus, locale);

  return (
    <CandidateLayout candidateId={candidate.id}>
      <h1>{t("billing.page.title")}</h1>
      {checkout === "success" ? (
        <p className="notice" role="status">
          {t("billing.page.checkoutSuccess")}
        </p>
      ) : null}
      {/* Checkout is only offered on Free: until Stripe's webhook moves the Candidate off it, keep looking. */}
      {checkout === "success" && plan === FREE_PLAN ? <RefreshUntilPlanConfirmed /> : null}
      {error ? (
        <p className="notice" role="alert">
          {t(error === "unavailable" ? "billing.page.unavailable" : "billing.page.error")}
        </p>
      ) : null}
      <p className="lead">{currentPlanLabel({ planName, endsAt }, locale)}</p>
      {paymentFailed ? <PaymentFailedNotice notice={paymentFailed} /> : null}

      <h2>{t("billing.page.usageTitle")}</h2>
      <dl>
        {MONTHLY_QUOTAS.filter((quota) => quotas[quota] !== 0).map((quota) => (
          <div key={quota}>
            <dt>{t(`billing.quotas.${quota}`)}</dt>
            <dd>
              {quotas[quota] === null
                ? t("billing.page.usageUnlimited", { used: usedThisMonth[quota] })
                : t("billing.page.usage", { used: usedThisMonth[quota], limit: quotas[quota] })}
            </dd>
          </div>
        ))}
      </dl>

      <h2>{t("billing.page.comparisonTitle")}</h2>
      <div className="table-scroll">
        <table className="plan-table">
          <thead>
            <tr>
              <th scope="col">{t("billing.page.quota")}</th>
              {offered.map(({ key, name }) => (
                <th scope="col" key={key} aria-current={key === plan ? "true" : undefined}>
                  {name[locale]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {prices ? (
              <tr>
                <th scope="row">{t("billing.page.price")}</th>
                {offered.map(({ key }) => (
                  <td key={key}>{prices[key] ? planPriceLabel(prices[key], locale) : null}</td>
                ))}
              </tr>
            ) : null}
            {QUOTA_ROWS.map((quota) => (
              <tr key={quota}>
                <th scope="row">{t(`billing.quotas.${quota}`)}</th>
                {offered.map(({ key }) => (
                  <td key={key}>{allQuotas[key] ? planQuotaValue(t, quota, allQuotas[key]) : null}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {offered.map(({ key, name, stripeProductId }) => (
                <td key={key}>
                  {key === plan ? (
                    <strong>{t("billing.page.current")}</strong>
                  ) : key !== FREE_PLAN && stripeProductId && plan === FREE_PLAN ? (
                    <form method="post" action="/api/billing/checkout">
                      <input type="hidden" name="plan" value={key} />
                      <button className="button button-primary" type="submit">
                        {t("billing.page.choose", { plan: name[locale] })}
                      </button>
                    </form>
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {plan !== FREE_PLAN ? (
        <form className="stack" method="post" action="/api/billing/portal">
          <p>{t("billing.page.manageHelp")}</p>
          <button className="button button-primary" type="submit">
            {t("billing.page.manage")}
          </button>
        </form>
      ) : null}

      {hasInvoices ? (
        <form className="stack" method="post" action="/api/billing/portal">
          <p>{t("billing.page.invoicesHelp")}</p>
          <button className="button" type="submit">
            {t("billing.page.invoices")}
          </button>
        </form>
      ) : null}
    </CandidateLayout>
  );
}
