import { FREE_PLAN, PLAN_FEATURES } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { planFromForm } from "@/admin/plan-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import type { PlanDefinition, PlanError } from "@/billing";
import { getBilling } from "@/billing/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox, Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../section.css";

const ERRORS = [
  "unknown_plan",
  "invalid_key",
  "key_taken",
  "invalid_name",
  "invalid_status",
  "invalid_feature",
  "not_a_product_id",
  "product_taken",
  "product_not_found",
  "product_archived",
  "no_recurring_default_price",
  "stripe_unavailable",
  "product_required",
  "product_frozen",
  "conflict",
  "free_plan_built_in",
  "cannot_move",
] as const satisfies readonly PlanError[];

/** The value a ticked checkbox sends. */
const TICKED = "on";
const UP = "up";
const DOWN = "down";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("plans");
  const t = await getServerT();
  return { title: `${t("admin.plans.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const failed = (error: PlanError) => redirect(`${routes.adminPlans}?error=${error}`);

async function createPlan(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("plans", "write");
  const created = await getBackOffice().createPlan(administrator, planFromForm(form));
  if (!created.ok) failed(created.error);
  else redirect(`${routes.adminPlans}?created=${created.plan.key}`);
}

async function savePlan(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("plans", "write");
  const plan = String(form.get("plan") ?? "");
  const saved = await getBackOffice().updatePlan(administrator, plan, planFromForm(form));
  if (!saved.ok) failed(saved.error);
  else redirect(`${routes.adminPlans}?saved=${plan}`);
}

async function movePlan(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("plans", "write");
  const moved = await getBackOffice().movePlan(administrator, String(form.get("plan") ?? ""), form.get("direction") === UP ? UP : DOWN);
  if (!moved.ok) failed(moved.error);
  else redirect(`${routes.adminPlans}?moved=1`);
}

/**
 * Administrators define the Plans: names, rank (the order of the comparison and of Upgrade
 * Prompts), offered or hidden, Stripe product and Plan Features. A new Plan starts hidden.
 * Plans are never deleted; Free is built in.
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<{ saved?: string; created?: string; moved?: string; error?: string }> }) {
  const { access, canWrite } = await requireBackOffice("plans");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { saved, created, moved, error } = await searchParams;
  const plans = await getBilling().plans();
  // Notices name a Plan from the database only: nothing typed in the address bar is shown.
  const savedPlan = plans.find((plan) => plan.key === saved);
  const createdPlan = plans.find((plan) => plan.key === created);
  const isError = (value: string | undefined): value is (typeof ERRORS)[number] => ERRORS.includes(value as (typeof ERRORS)[number]);
  const name = (plan: PlanDefinition) => plan.name[locale];
  const features = (plan: PlanDefinition) => (plan.features.length ? plan.features.map((feature) => t(`admin.plans.featureNames.${feature}`)).join(", ") : t("admin.plans.noFeatures"));

  return (
    <BackOfficeLayout access={access} title={t("admin.plans.title")}>
      <div className="section-page">
        <PageIntro t={t} page="plans" subject={t("admin.plans.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {savedPlan ? (
          <Note tone="success" role="status">
            {t("admin.plans.saved", { plan: name(savedPlan) })}
          </Note>
        ) : null}
        {createdPlan ? (
          <Note tone="success" role="status">
            {t("admin.plans.created", { plan: name(createdPlan) })}
          </Note>
        ) : null}
        {moved ? (
          <Note tone="success" role="status">
            {t("admin.plans.moved")}
          </Note>
        ) : null}
        {isError(error) ? (
          <Note tone="danger" role="alert">
            {t(`admin.plans.errors.${error}`)}
          </Note>
        ) : null}

        <Table
          label={t("admin.plans.caption")}
          columns={[
            {
              key: "rank",
              header: t("admin.plans.rank"),
              cell: ({ plan, index }) => {
                // Free stays first: it has no buttons, and the Plan just above it cannot go down.
                const canMoveUp = plan.key !== FREE_PLAN && index < plans.length - 1;
                const canMoveDown = plan.key !== FREE_PLAN && index > 1;
                return (
                  <span className="section-actions">
                    {plan.rank}
                    {canWrite && canMoveUp ? <MoveButton plan={plan} direction={UP} label={t("admin.plans.moveUp", { plan: name(plan) })} /> : null}
                    {canWrite && canMoveDown ? <MoveButton plan={plan} direction={DOWN} label={t("admin.plans.moveDown", { plan: name(plan) })} /> : null}
                  </span>
                );
              },
            },
            { key: "name", header: t("admin.plans.name"), rowHeader: true, cell: ({ plan }) => name(plan) },
            { key: "key", header: t("admin.plans.key"), cell: ({ plan }) => <code>{plan.key}</code> },
            { key: "status", header: t("admin.plans.statusLabel"), cell: ({ plan }) => <Pill tone={plan.status === "offered" ? "success" : "neutral"}>{t(`admin.plans.status.${plan.status}`)}</Pill> },
            { key: "product", header: t("admin.plans.product"), cell: ({ plan }) => (plan.stripeProductId ? <code>{plan.stripeProductId}</code> : t("admin.plans.noProduct")) },
            { key: "features", header: t("admin.plans.features"), cell: ({ plan }) => features(plan) },
          ]}
          rows={plans.map((plan, index) => ({ plan, index }))}
          rowKey={({ plan }) => plan.key}
        />

        {plans.map((plan) => {
          const free = plan.key === FREE_PLAN;
          return (
            <BackOfficeForm key={plan.key} canWrite={canWrite} action={savePlan}>
              <input type="hidden" name="plan" value={plan.key} />
              <Card title={t("admin.plans.edit", { plan: name(plan) })}>
                {/* Read-only for roles that may not change Plans: the fields show, disabled, with nothing to send. */}
                <fieldset className="section-form" disabled={!canWrite}>
                  {free ? <p>{t("admin.plans.free")}</p> : null}
                  <NameFields plan={plan} labels={{ fr: t("admin.plans.nameFr"), en: t("admin.plans.nameEn") }} />
                  {free ? (
                    // Free is always offered: what the form sends says so.
                    <input type="hidden" name="offered" value={TICKED} />
                  ) : (
                    <>
                      <Checkbox name="offered" defaultChecked={plan.status === "offered"} label={t("admin.plans.offeredLabel")} hint={t("admin.plans.hiddenHelp")} />
                      {plan.stripeProductId ? (
                        // Frozen once set: its subscribers stay on that product. Shown, never sent.
                        <Properties>
                          <Property term={t("admin.plans.product")} meta={t("admin.plans.productFrozenHelp")}>
                            <code>{plan.stripeProductId}</code>
                          </Property>
                        </Properties>
                      ) : (
                        <Field label={t("admin.plans.product")} hint={t("admin.plans.productHelp")}>
                          <TextInput name="stripeProductId" autoComplete="off" spellCheck={false} />
                        </Field>
                      )}
                    </>
                  )}
                  <FeatureFields checked={plan.features} t={t} />
                  {canWrite ? (
                    <button className={buttonClass({ variant: "primary" })} type="submit">
                      {t("admin.plans.save", { plan: name(plan) })}
                    </button>
                  ) : null}
                </fieldset>
              </Card>
            </BackOfficeForm>
          );
        })}

        {canWrite ? (
          <form action={createPlan}>
            <Card title={t("admin.plans.createTitle")}>
              <div className="section-form">
                <p>{t("admin.plans.createHelp")}</p>
                <Field label={t("admin.plans.key")} hint={t("admin.plans.keyHelp")}>
                  <TextInput name="key" required pattern="[a-z][a-z0-9\-]{1,31}" autoComplete="off" spellCheck={false} />
                </Field>
                <NameFields labels={{ fr: t("admin.plans.nameFr"), en: t("admin.plans.nameEn") }} />
                <Field label={t("admin.plans.product")} hint={t("admin.plans.productHelp")}>
                  <TextInput name="stripeProductId" required autoComplete="off" spellCheck={false} />
                </Field>
                <FeatureFields checked={[]} t={t} />
                <button className={buttonClass({ variant: "primary" })} type="submit">
                  {t("admin.plans.create")}
                </button>
              </div>
            </Card>
          </form>
        ) : null}
      </div>
    </BackOfficeLayout>
  );
}

function MoveButton({ plan, direction, label }: { plan: PlanDefinition; direction: "up" | "down"; label: string }) {
  return (
    <form action={movePlan}>
      <input type="hidden" name="plan" value={plan.key} />
      <input type="hidden" name="direction" value={direction} />
      <button className={buttonClass({ size: "sm" })} type="submit" aria-label={label} title={label}>
        <span aria-hidden="true">{direction === UP ? "↑" : "↓"}</span>
      </button>
    </form>
  );
}

function NameFields({ plan, labels }: { plan?: PlanDefinition; labels: { fr: string; en: string } }) {
  return (
    <>
      <Field label={labels.fr}>
        <TextInput name="nameFr" lang="fr" required maxLength={60} defaultValue={plan?.name.fr} autoComplete="off" />
      </Field>
      <Field label={labels.en}>
        <TextInput name="nameEn" lang="en" required maxLength={60} defaultValue={plan?.name.en} autoComplete="off" />
      </Field>
    </>
  );
}

function FeatureFields({ checked, t }: { checked: readonly string[]; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <fieldset>
      <legend>{t("admin.plans.features")}</legend>
      {PLAN_FEATURES.map((feature) => (
        <Checkbox
          key={feature}
          name="features"
          value={feature}
          defaultChecked={checked.includes(feature)}
          label={t(`admin.plans.featureNames.${feature}`)}
          hint={t(`admin.plans.featureHelp.${feature}`)}
        />
      ))}
    </fieldset>
  );
}
