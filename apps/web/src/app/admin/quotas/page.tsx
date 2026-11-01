import { FREE_PLAN, LIMITED_QUOTAS, JOB_DIGEST_FREQUENCIES, WEEKLY_QUOTAS, type WeeklyQuota } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { planQuotasFromForm, reductionNoticeFromForm } from "@/admin/plan-quotas-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { getBilling } from "@/billing/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { ReductionNoticeFields } from "@/components/ReductionNoticeFields";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox, Field, Select, Textarea, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { earliestEffectiveOn, type ReductionError } from "@/quota-reductions";
import { longDay } from "@/quota-reductions/describe";
import { routes } from "@/routes";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "planQuotas";

/** Why a change of quotas may be refused (#514): each has its message. */
const REDUCTION_ERRORS = ["notice_required", "invalid_effective_date", "too_soon", "reduction_pending", "reason_too_long", "unknown_plan"] as const satisfies readonly ReductionError[];
const isReductionError = (value: string | undefined): value is ReductionError => REDUCTION_ERRORS.includes(value as ReductionError);

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
  const changed = await getBackOffice().setPlanQuotas(administrator, submitted.plan, submitted.quotas, reductionNoticeFromForm(form));
  if (!changed.ok) redirect(`${routes.adminPlanQuotas}?error=${changed.error}&plan=${encodeURIComponent(submitted.plan)}`);
  const scheduled = changed.scheduled ? `&effectiveOn=${changed.scheduled.effectiveOn}&subscribers=${changed.scheduled.subscribers}` : "";
  redirect(`${routes.adminPlanQuotas}?saved=${submitted.plan}${scheduled}`);
}

async function resetWeeklyUsage(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("planQuotas", "write");
  const confirmed = form.get("confirm") === "on";
  const result = confirmed ? await getBackOffice().resetWeeklyUsage(administrator, String(form.get("reason") ?? "")) : null;
  if (!result?.ok) redirect(`${routes.adminPlanQuotas}?resetRefused=1#reset-usage`);
  redirect(`${routes.adminPlanQuotas}?reset=${result.candidates}#reset-usage`);
}

/**
 * Administrators edit each Plan's quotas, in rank order, hidden Plans included; empty means unlimited.
 * Below, those who may change them can reset this week's usage of every Candidate, with a reason (ADR-0032).
 */
export default async function PlanQuotasPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; invalid?: string; reset?: string; resetRefused?: string; error?: string; effectiveOn?: string; subscribers?: string }>;
}) {
  const { access, canWrite } = await requireBackOffice("planQuotas");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { saved, invalid, reset, resetRefused, error, effectiveOn, subscribers } = await searchParams;
  const earliest = earliestEffectiveOn(new Date());
  // A scheduled reduction is named from the database and a date that parses: nothing typed in the address bar is shown.
  const scheduledOn = effectiveOn && /^\d{4}-\d{2}-\d{2}$/.test(effectiveOn) ? effectiveOn : null;
  const [plans, quotas] = await Promise.all([getBilling().plans(), getBilling().planQuotas()]);
  const savedPlan = plans.find((plan) => plan.key === saved);

  return (
    <BackOfficeLayout access={access} title={t("admin.planQuotas.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.planQuotas.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {savedPlan ? (
          <Note tone="success" role="status">
            {scheduledOn ? (
              <>
                {t("admin.quotaReductions.scheduled", { plan: savedPlan.name[locale], date: longDay(scheduledOn, locale), count: Number(subscribers) || 0 })}{" "}
                <a href={`${routes.adminPlans}#baisses`}>{t("admin.quotaReductions.seePending")}</a>
              </>
            ) : (
              t("admin.planQuotas.saved", { plan: savedPlan.name[locale] })
            )}
          </Note>
        ) : null}
        {isReductionError(error) ? (
          <Note tone="danger" role="alert">
            {t(`admin.quotaReductions.errors.${error}`)}
          </Note>
        ) : null}
        {invalid ? (
          <Note tone="danger" role="alert">
            {t("admin.planQuotas.invalid")}
          </Note>
        ) : null}
        {plans.map(({ key: plan, name, status }) => (
          <BackOfficeForm key={plan} canWrite={canWrite} action={savePlanQuotas}>
            <input type="hidden" name="plan" value={plan} />
            <Card title={`${t("admin.planQuotas.plan", { plan: name[locale] })}${status === "hidden" ? ` (${t("admin.plans.status.hidden")})` : ""}`}>
              {/* Read-only for roles that may not change Plan Quotas: no field to edit, no button to save. */}
              <fieldset className="section-form" disabled={!canWrite}>
                {LIMITED_QUOTAS.map((quota) => {
                  const weekly = WEEKLY_QUOTAS.includes(quota as WeeklyQuota);
                  return (
                    <Field
                      key={quota}
                      label={weekly ? `${t(`billing.quotas.${quota}`)} (${t("admin.planQuotas.weekly")})` : t(`billing.quotas.${quota}`)}
                      hint={t("admin.planQuotas.limitHelp")}
                    >
                      <TextInput name={quota} inputMode="numeric" pattern="[0-9]*" defaultValue={quotas[plan]?.[quota] ?? ""} />
                    </Field>
                  );
                })}
                <Field label={t("billing.quotas.jobDigest")}>
                  <Select name="jobDigest" defaultValue={quotas[plan]?.jobDigest}>
                    {JOB_DIGEST_FREQUENCIES.map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {t(`billing.jobDigest.${frequency}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {plan !== FREE_PLAN && canWrite ? <ReductionNoticeFields t={t} earliest={earliest} /> : null}
                {canWrite ? (
                  <button className={buttonClass({ variant: "primary" })} type="submit">
                    {t("admin.planQuotas.save", { plan: name[locale] })}
                  </button>
                ) : null}
              </fieldset>
            </Card>
          </BackOfficeForm>
        ))}
        {canWrite ? (
          <form action={resetWeeklyUsage} aria-labelledby="reset-usage">
            <Card title={<span id="reset-usage">{t("admin.planQuotas.reset.title")}</span>}>
              <div className="section-form">
                <p>{t("admin.planQuotas.reset.intro")}</p>
                {reset !== undefined ? (
                  <Note tone="success" role="status">
                    {t("admin.planQuotas.reset.done", { count: Number(reset) || 0 })}
                  </Note>
                ) : null}
                {resetRefused ? (
                  <Note tone="danger" role="alert">
                    {t("admin.planQuotas.reset.refused")}
                  </Note>
                ) : null}
                <Field label={t("admin.planQuotas.reset.reason")} hint={t("admin.planQuotas.reset.reasonHelp")}>
                  <Textarea name="reason" required />
                </Field>
                <Checkbox name="confirm" required label={t("admin.planQuotas.reset.confirm")} />
                <button className={buttonClass({ variant: "danger" })} type="submit">
                  {t("admin.planQuotas.reset.submit")}
                </button>
              </div>
            </Card>
          </form>
        ) : null}
      </div>
    </BackOfficeLayout>
  );
}
