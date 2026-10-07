import { LIMITED_QUOTAS, JOB_DIGEST_FREQUENCIES, MONTHLY_QUOTAS, PLANS, type MonthlyQuota, type Plan } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { planQuotasFromForm } from "@/admin/plan-quotas-form";
import { requireAdministrator } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeHeader } from "@/components/BackOfficeHeader";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireAdministrator();
  const t = await getServerT();
  return { title: `${t("admin.planQuotas.title")} · ${t("admin.title")}`, robots: { index: false } };
}

async function savePlanQuotas(form: FormData) {
  "use server";
  await requireAdministrator();
  const submitted = planQuotasFromForm(form);
  if (!submitted) redirect(`${routes.adminPlanQuotas}?invalid=${encodeURIComponent(String(form.get("plan")))}`);
  await getBilling().setPlanQuotas(submitted.plan, submitted.quotas);
  redirect(`${routes.adminPlanQuotas}?saved=${submitted.plan}`);
}

/** Administrators edit each Plan's quotas; empty means unlimited. */
export default async function PlanQuotasPage({ searchParams }: { searchParams: Promise<{ saved?: string; invalid?: string }> }) {
  await requireAdministrator();
  const t = await getServerT();
  const { saved, invalid } = await searchParams;
  const quotas = await getBilling().planQuotas();
  const planName = (plan: Plan) => t(`billing.plans.${plan}`);
  const isPlan = (value: string | undefined): value is Plan => PLANS.includes(value as Plan);

  return (
    <main className="page">
      <BackOfficeHeader />
      <p>
        <Link href={routes.admin}>{t("admin.back")}</Link>
      </p>
      <h1>{t("admin.planQuotas.title")}</h1>
      <p className="lead">{t("admin.planQuotas.intro")}</p>
      {isPlan(saved) ? (
        <p className="notice" role="status">
          {t("admin.planQuotas.saved", { plan: planName(saved) })}
        </p>
      ) : null}
      {invalid ? (
        <p className="notice" role="alert">
          {t("admin.planQuotas.invalid")}
        </p>
      ) : null}
      {PLANS.map((plan) => (
        <form key={plan} className="stack quota-form" action={savePlanQuotas}>
          <input type="hidden" name="plan" value={plan} />
          <fieldset>
            <legend>
              <h2>{t("admin.planQuotas.plan", { plan: planName(plan) })}</h2>
            </legend>
            {LIMITED_QUOTAS.map((quota) => {
              const id = `${plan}-${quota}`;
              const monthly = MONTHLY_QUOTAS.includes(quota as MonthlyQuota);
              return (
                <div key={quota} className="stack">
                  <label htmlFor={id}>
                    {monthly ? `${t(`billing.quotas.${quota}`)} (${t("admin.planQuotas.monthly")})` : t(`billing.quotas.${quota}`)}
                  </label>
                  <input
                    id={id}
                    className="input"
                    name={quota}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    defaultValue={quotas[plan][quota] ?? ""}
                    aria-describedby={`${id}-help`}
                  />
                  <p id={`${id}-help`}>{t("admin.planQuotas.limitHelp")}</p>
                </div>
              );
            })}
            <div className="stack">
              <label htmlFor={`${plan}-jobDigest`}>{t("billing.quotas.jobDigest")}</label>
              <select id={`${plan}-jobDigest`} className="input" name="jobDigest" defaultValue={quotas[plan].jobDigest}>
                {JOB_DIGEST_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {t(`billing.jobDigest.${frequency}`)}
                  </option>
                ))}
              </select>
            </div>
            <button className="button button-primary" type="submit">
              {t("admin.planQuotas.save", { plan: planName(plan) })}
            </button>
          </fieldset>
        </form>
      ))}
    </main>
  );
}
