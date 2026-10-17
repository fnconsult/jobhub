import { FREE_PLAN, PLAN_FEATURES } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { planFromForm } from "@/admin/plan-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import type { PlanDefinition, PlanError } from "@/billing";
import { getBilling } from "@/billing/server";
import { BackOfficeForm } from "@/components/BackOfficeForm";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

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
    <BackOfficeLayout access={access}>
      <h1>{t("admin.plans.title")}</h1>
      <p className="lead">{t("admin.plans.intro")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {savedPlan ? (
        <p className="notice" role="status">
          {t("admin.plans.saved", { plan: name(savedPlan) })}
        </p>
      ) : null}
      {createdPlan ? (
        <p className="notice" role="status">
          {t("admin.plans.created", { plan: name(createdPlan) })}
        </p>
      ) : null}
      {moved ? (
        <p className="notice" role="status">
          {t("admin.plans.moved")}
        </p>
      ) : null}
      {isError(error) ? (
        <p className="notice" role="alert">
          {t(`admin.plans.errors.${error}`)}
        </p>
      ) : null}

      <div className="table-scroll">
        <table className="application-table">
          <caption>{t("admin.plans.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.plans.rank")}</th>
              <th scope="col">{t("admin.plans.name")}</th>
              <th scope="col">{t("admin.plans.key")}</th>
              <th scope="col">{t("admin.plans.statusLabel")}</th>
              <th scope="col">{t("admin.plans.product")}</th>
              <th scope="col">{t("admin.plans.features")}</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan, index) => {
              // Free stays first: it has no buttons, and the Plan just above it cannot go down.
              const canMoveUp = plan.key !== FREE_PLAN && index < plans.length - 1;
              const canMoveDown = plan.key !== FREE_PLAN && index > 1;
              return (
                <tr key={plan.key}>
                  <td>
                    <span className="plan-rank">
                      {plan.rank}
                      {canWrite && canMoveUp ? <MoveButton plan={plan} direction={UP} label={t("admin.plans.moveUp", { plan: name(plan) })} /> : null}
                      {canWrite && canMoveDown ? <MoveButton plan={plan} direction={DOWN} label={t("admin.plans.moveDown", { plan: name(plan) })} /> : null}
                    </span>
                  </td>
                  <th scope="row">{name(plan)}</th>
                  <td>
                    <code>{plan.key}</code>
                  </td>
                  <td>{t(`admin.plans.status.${plan.status}`)}</td>
                  <td>{plan.stripeProductId ? <code>{plan.stripeProductId}</code> : t("admin.plans.noProduct")}</td>
                  <td>{features(plan)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {plans.map((plan) => {
        const id = (field: string) => `plan-${plan.key}-${field}`;
        const free = plan.key === FREE_PLAN;
        return (
          <BackOfficeForm key={plan.key} canWrite={canWrite} className="stack quota-form" action={savePlan}>
            <input type="hidden" name="plan" value={plan.key} />
            {/* Read-only for roles that may not change Plans: the fields show, disabled, with nothing to send. */}
            <fieldset disabled={!canWrite}>
              <legend>
                <h2>{t("admin.plans.edit", { plan: name(plan) })}</h2>
              </legend>
              {free ? <p>{t("admin.plans.free")}</p> : null}
              <NameFields id={id} plan={plan} labels={{ fr: t("admin.plans.nameFr"), en: t("admin.plans.nameEn") }} />
              {free ? (
                // Free is always offered: what the form sends says so.
                <input type="hidden" name="offered" value={TICKED} />
              ) : (
                <>
                  <div className="checkbox-field">
                    <input id={id("offered")} type="checkbox" name="offered" defaultChecked={plan.status === "offered"} aria-describedby={id("offered-help")} />
                    <label htmlFor={id("offered")}>{t("admin.plans.offeredLabel")}</label>
                    <p id={id("offered-help")}>{t("admin.plans.hiddenHelp")}</p>
                  </div>
                  {plan.stripeProductId ? (
                    // Frozen once set: its subscribers stay on that product. Shown, never sent.
                    <div className="stack">
                      <dl>
                        <dt>{t("admin.plans.product")}</dt>
                        <dd>
                          <code>{plan.stripeProductId}</code>
                        </dd>
                      </dl>
                      <p>{t("admin.plans.productFrozenHelp")}</p>
                    </div>
                  ) : (
                    <div className="stack">
                      <label htmlFor={id("product")}>{t("admin.plans.product")}</label>
                      <input
                        id={id("product")}
                        className="input"
                        name="stripeProductId"
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={id("product-help")}
                      />
                      <p id={id("product-help")}>{t("admin.plans.productHelp")}</p>
                    </div>
                  )}
                </>
              )}
              <FeatureFields id={id} checked={plan.features} t={t} />
              {canWrite ? (
                <button className="button button-primary" type="submit">
                  {t("admin.plans.save", { plan: name(plan) })}
                </button>
              ) : null}
            </fieldset>
          </BackOfficeForm>
        );
      })}

      {canWrite ? (
        <form className="stack quota-form" action={createPlan}>
          <fieldset>
            <legend>
              <h2>{t("admin.plans.createTitle")}</h2>
            </legend>
            <p>{t("admin.plans.createHelp")}</p>
            <div className="stack">
              <label htmlFor="new-plan-key">{t("admin.plans.key")}</label>
              <input
                id="new-plan-key"
                className="input"
                name="key"
                required
                pattern="[a-z][a-z0-9\-]{1,31}"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="new-plan-key-help"
              />
              <p id="new-plan-key-help">{t("admin.plans.keyHelp")}</p>
            </div>
            <NameFields id={(field) => `new-plan-${field}`} labels={{ fr: t("admin.plans.nameFr"), en: t("admin.plans.nameEn") }} />
            <div className="stack">
              <label htmlFor="new-plan-product">{t("admin.plans.product")}</label>
              <input id="new-plan-product" className="input" name="stripeProductId" required autoComplete="off" spellCheck={false} aria-describedby="new-plan-product-help" />
              <p id="new-plan-product-help">{t("admin.plans.productHelp")}</p>
            </div>
            <FeatureFields id={(field) => `new-plan-${field}`} checked={[]} t={t} />
            <button className="button button-primary" type="submit">
              {t("admin.plans.create")}
            </button>
          </fieldset>
        </form>
      ) : null}
    </BackOfficeLayout>
  );
}

function MoveButton({ plan, direction, label }: { plan: PlanDefinition; direction: "up" | "down"; label: string }) {
  return (
    <form action={movePlan}>
      <input type="hidden" name="plan" value={plan.key} />
      <input type="hidden" name="direction" value={direction} />
      <button className="button" type="submit" aria-label={label} title={label}>
        <span aria-hidden="true">{direction === UP ? "↑" : "↓"}</span>
      </button>
    </form>
  );
}

function NameFields({ id, plan, labels }: { id: (field: string) => string; plan?: PlanDefinition; labels: { fr: string; en: string } }) {
  return (
    <>
      <div className="stack">
        <label htmlFor={id("name-fr")}>{labels.fr}</label>
        <input id={id("name-fr")} className="input" name="nameFr" lang="fr" required maxLength={60} defaultValue={plan?.name.fr} autoComplete="off" />
      </div>
      <div className="stack">
        <label htmlFor={id("name-en")}>{labels.en}</label>
        <input id={id("name-en")} className="input" name="nameEn" lang="en" required maxLength={60} defaultValue={plan?.name.en} autoComplete="off" />
      </div>
    </>
  );
}

function FeatureFields({ id, checked, t }: { id: (field: string) => string; checked: readonly string[]; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <fieldset className="stack">
      <legend>{t("admin.plans.features")}</legend>
      {PLAN_FEATURES.map((feature) => (
        <div key={feature} className="checkbox-field">
          <input id={id(feature)} type="checkbox" name="features" value={feature} defaultChecked={checked.includes(feature)} aria-describedby={id(`${feature}-help`)} />
          <label htmlFor={id(feature)}>{t(`admin.plans.featureNames.${feature}`)}</label>
          <p id={id(`${feature}-help`)}>{t(`admin.plans.featureHelp.${feature}`)}</p>
        </div>
      ))}
    </fieldset>
  );
}
