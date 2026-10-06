import { LIMITED_QUOTAS, MONTHLY_QUOTAS, PLANS, type PlanQuotas } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { planQuotaValue } from "@/billing/quota-labels";
import { getBilling } from "@/billing/server";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("billing.page.title")} · ${t("app.name")}` };
}

const QUOTA_ROWS = [...LIMITED_QUOTAS, "jobDigest"] as const satisfies readonly (keyof PlanQuotas)[];

/** The Candidate's Plan, this month's usage, the Plans side by side, and the way to Stripe. */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const { checkout, error } = await searchParams;
  const billing = getBilling();
  const [{ plan, quotas, usedThisMonth }, allQuotas] = await Promise.all([billing.entitlements(candidate.id), billing.planQuotas()]);
  const planName = (name: (typeof PLANS)[number]) => t(`billing.plans.${name}`);

  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <nav className="page-nav">
          <TextSizeControl />
          <Link className="button" href={routes.account}>
            {t("nav.account")}
          </Link>
        </nav>
      </header>
      <h1>{t("billing.page.title")}</h1>
      {checkout === "success" ? (
        <p className="notice" role="status">
          {t("billing.page.checkoutSuccess")}
        </p>
      ) : null}
      {error ? (
        <p className="notice" role="alert">
          {t(error === "unavailable" ? "billing.page.unavailable" : "billing.page.error")}
        </p>
      ) : null}
      <p className="lead">{t("billing.page.currentPlan", { plan: planName(plan) })}</p>

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
              {PLANS.map((name) => (
                <th scope="col" key={name} aria-current={name === plan ? "true" : undefined}>
                  {planName(name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {QUOTA_ROWS.map((quota) => (
              <tr key={quota}>
                <th scope="row">{t(`billing.quotas.${quota}`)}</th>
                {PLANS.map((name) => (
                  <td key={name}>{planQuotaValue(t, quota, allQuotas[name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              {PLANS.map((name) => (
                <td key={name}>
                  {name === plan ? (
                    <strong>{t("billing.page.current")}</strong>
                  ) : name !== "free" && plan === "free" ? (
                    <form method="post" action="/api/billing/checkout">
                      <input type="hidden" name="plan" value={name} />
                      <button className="button button-primary" type="submit">
                        {t("billing.page.choose", { plan: planName(name) })}
                      </button>
                    </form>
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {plan !== "free" ? (
        <form className="stack" method="post" action="/api/billing/portal">
          <p>{t("billing.page.manageHelp")}</p>
          <button className="button button-primary" type="submit">
            {t("billing.page.manage")}
          </button>
        </form>
      ) : null}
    </main>
  );
}
