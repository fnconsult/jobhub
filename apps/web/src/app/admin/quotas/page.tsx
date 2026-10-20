import { LIMITED_QUOTAS, JOB_DIGEST_FREQUENCIES, MONTHLY_QUOTAS, type MonthlyQuota } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { planQuotasFromForm } from "@/admin/plan-quotas-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("planQuotas");
  const t = await getServerT();
  return { title: `${t("admin.planQuotas.title")} · ${t("admin.title")}`, robots: { index: false } };
}

async function savePlanQuotas(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("planQuotas", "write");
  const submitted = planQuotasFromForm(form);
  if (!submitted) redirect(`${routes.adminPlanQuotas}?invalid=${encodeURIComponent(String(form.get("plan")))}`);
  await getBackOffice().setPlanQuotas(administrator, submitted.plan, submitted.quotas);
  redirect(`${routes.adminPlanQuotas}?saved=${submitted.plan}`);
}

/** Administrators edit each Plan's quotas, in rank order, hidden Plans included; empty means unlimited. */
export default async function PlanQuotasPage({ searchParams }: { searchParams: Promise<{ saved?: string; invalid?: string }> }) {
  const { access, canWrite } = await requireBackOffice("planQuotas");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { saved, invalid } = await searchParams;
  const [plans, quotas] = await Promise.all([getBilling().plans(), getBilling().planQuotas()]);
  const savedPlan = plans.find((plan) => plan.key === saved);

  return (
    <BackOfficeLayout access={access} title={t("admin.planQuotas.title")}>
      <p className="lead">{t("admin.planQuotas.intro")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {savedPlan ? (
        <p className="notice" role="status">
          {t("admin.planQuotas.saved", { plan: savedPlan.name[locale] })}
        </p>
      ) : null}
      {invalid ? (
        <p className="notice" role="alert">
          {t("admin.planQuotas.invalid")}
        </p>
      ) : null}
      {plans.map(({ key: plan, name, status }) => (
        <BackOfficeForm key={plan} canWrite={canWrite} className="stack quota-form" action={savePlanQuotas}>
          <input type="hidden" name="plan" value={plan} />
          {/* Read-only for roles that may not change Plan Quotas: no field to edit, no button to save. */}
          <fieldset disabled={!canWrite}>
            <legend>
              <h2>
                {t("admin.planQuotas.plan", { plan: name[locale] })}
                {status === "hidden" ? ` (${t("admin.plans.status.hidden")})` : null}
              </h2>
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
                    defaultValue={quotas[plan]?.[quota] ?? ""}
                    aria-describedby={`${id}-help`}
                  />
                  <p id={`${id}-help`}>{t("admin.planQuotas.limitHelp")}</p>
                </div>
              );
            })}
            <div className="stack">
              <label htmlFor={`${plan}-jobDigest`}>{t("billing.quotas.jobDigest")}</label>
              <select id={`${plan}-jobDigest`} className="input" name="jobDigest" defaultValue={quotas[plan]?.jobDigest}>
                {JOB_DIGEST_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {t(`billing.jobDigest.${frequency}`)}
                  </option>
                ))}
              </select>
            </div>
            {canWrite ? (
              <button className="button button-primary" type="submit">
                {t("admin.planQuotas.save", { plan: name[locale] })}
              </button>
            ) : null}
          </fieldset>
        </BackOfficeForm>
      ))}
    </BackOfficeLayout>
  );
}
