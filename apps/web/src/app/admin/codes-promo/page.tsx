import { FREE_PLAN } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { couponFromForm } from "@/admin/coupon-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import type { Coupon, CouponError, PlanDefinition } from "@/billing";
import { couponTermsLabel } from "@/billing/coupon-label";
import { getBilling } from "@/billing/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox, Field, Radio, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "coupons";

const ERRORS = [
  "invalid_code",
  "code_taken",
  "invalid_discount",
  "invalid_duration",
  "no_plan",
  "plan_not_sold",
  "invalid_expiry",
  "invalid_max_redemptions",
  "amount_covers_price",
  "currency_not_eur",
  "unknown_coupon",
  "stripe_unavailable",
] as const satisfies readonly CouponError[];

const DURATIONS = ["once", "repeating", "forever"] as const;
const KINDS = ["percent", "amount"] as const;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("coupons");
  const t = await getServerT();
  return { title: `${t("admin.coupons.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const failed = (error: CouponError) => redirect(`${routes.adminCoupons}?error=${error}`);

async function createCoupon(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coupons", "write");
  const created = await getBackOffice().createCoupon(administrator, couponFromForm(form));
  if (!created.ok) failed(created.error);
  else redirect(`${routes.adminCoupons}?created=${encodeURIComponent(created.coupon.id)}`);
}

async function deactivateCoupon(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("coupons", "write");
  const id = String(form.get("coupon") ?? "");
  const deactivated = await getBackOffice().deactivateCoupon(administrator, id);
  if (!deactivated.ok) failed(deactivated.error);
  else redirect(`${routes.adminCoupons}?deactivated=${encodeURIComponent(id)}`);
}

/**
 * Plans managers create Coupons (Stripe coupons and their promotion codes) and deactivate them;
 * Support reads them. Their terms never change once created. Redemptions are Stripe's count.
 */
export default async function CouponsPage({ searchParams }: { searchParams: Promise<{ created?: string; deactivated?: string; error?: string }> }) {
  const { access, canWrite } = await requireBackOffice("coupons");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { created, deactivated, error } = await searchParams;
  const billing = getBilling();
  const [coupons, plans] = await Promise.all([billing.coupons(), billing.plans()]);
  // Notices name a code read from Stripe only: nothing typed in the address bar is shown.
  const createdCoupon = coupons?.find((coupon) => coupon.id === created);
  const deactivatedCoupon = coupons?.find((coupon) => coupon.id === deactivated);
  const isError = (value: string | undefined): value is (typeof ERRORS)[number] => ERRORS.includes(value as (typeof ERRORS)[number]);
  const sold = plans.filter((plan) => plan.key !== FREE_PLAN && plan.stripeProductId);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" });
  const planNames = (coupon: Coupon) =>
    coupon.plans === null ? t("admin.coupons.allPlans") : coupon.plans.map((key) => plans.find((plan) => plan.key === key)?.name[locale] ?? key).join(", ");

  return (
    <BackOfficeLayout access={access} title={t("admin.coupons.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.coupons.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {createdCoupon ? (
          <Note tone="success" role="status">
            {t("admin.coupons.created", { code: createdCoupon.code })}
          </Note>
        ) : null}
        {deactivatedCoupon ? (
          <Note tone="success" role="status">
            {t("admin.coupons.deactivated", { code: deactivatedCoupon.code })}
          </Note>
        ) : null}
        {isError(error) ? (
          <Note tone="danger" role="alert">
            {t(`admin.coupons.errors.${error}`)}
          </Note>
        ) : null}

        {coupons === null ? (
          <Note tone="danger" role="alert">
            {t("admin.coupons.unavailable")}
          </Note>
        ) : coupons.length === 0 ? (
          <p>{t("admin.coupons.none")}</p>
        ) : (
          <Table
            label={t("admin.coupons.caption")}
            columns={[
              { header: t("admin.coupons.code"), rowHeader: true, cell: (coupon) => <code>{coupon.code}</code> },
              {
                header: t("admin.coupons.terms"),
                cell: (coupon) =>
                  "unreadable" in coupon ? (
                    t("admin.coupons.unreadable")
                  ) : (
                    <>
                      {couponTermsLabel(coupon, locale)}
                      {coupon.firstPaymentOnly ? ` (${t("admin.coupons.firstPaymentOnly")})` : null}
                    </>
                  ),
              },
              { header: t("admin.coupons.plans"), cell: (coupon) => ("unreadable" in coupon ? null : planNames(coupon)) },
              {
                header: t("admin.coupons.expiresAt"),
                cell: (coupon) => ("unreadable" in coupon ? null : coupon.expiresAt ? date.format(coupon.expiresAt) : t("admin.coupons.noExpiry")),
              },
              {
                header: t("admin.coupons.redemptions"),
                numeric: true,
                cell: (coupon) =>
                  "unreadable" in coupon
                    ? null
                    : coupon.maxRedemptions === null
                      ? coupon.timesRedeemed
                      : t("admin.coupons.redemptionsOf", { used: coupon.timesRedeemed, max: coupon.maxRedemptions }),
              },
              {
                header: t("admin.coupons.statusLabel"),
                cell: (coupon) =>
                  "unreadable" in coupon ? null : <Pill tone={coupon.active ? "success" : "neutral"}>{t(`admin.coupons.status.${coupon.active ? "active" : "inactive"}`)}</Pill>,
              },
              { header: t("admin.coupons.link"), cell: (coupon) => ("unreadable" in coupon ? null : <code>{`${routes.subscription}?code=${encodeURIComponent(coupon.code)}`}</code>) },
              ...(canWrite
                ? [
                    {
                      header: <span className="visually-hidden">{t("admin.rowActions")}</span>,
                      cell: (coupon: (typeof coupons)[number]) =>
                        "unreadable" in coupon || !coupon.active ? null : (
                          <form action={deactivateCoupon}>
                            <input type="hidden" name="coupon" value={coupon.id} />
                            <button className={buttonClass({ variant: "danger", size: "sm" })} type="submit">
                              {t("admin.coupons.deactivate", { code: coupon.code })}
                            </button>
                          </form>
                        ),
                    },
                  ]
                : []),
            ]}
            rows={coupons}
            rowKey={(coupon) => coupon.id}
          />
        )}
        {canWrite ? <p className="section-meta">{t("admin.coupons.deactivateHelp")}</p> : null}

        {canWrite ? <CreateCouponForm plans={sold} locale={locale} t={t} /> : null}
      </div>
    </BackOfficeLayout>
  );
}

function CreateCouponForm({ plans, locale, t }: { plans: PlanDefinition[]; locale: "fr" | "en"; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <form action={createCoupon}>
      <Card title={t("admin.coupons.createTitle")}>
        <div className="section-form">
          <p>{t("admin.coupons.createHelp")}</p>
          <Field label={t("admin.coupons.code")} hint={t("admin.coupons.codeHelp")}>
            <TextInput name="code" required pattern="[A-Za-z0-9_\-]{3,40}" autoComplete="off" spellCheck={false} />
          </Field>
          <fieldset>
            <legend>{t("admin.coupons.kind")}</legend>
            {KINDS.map((kind) => (
              <Radio key={kind} name="kind" value={kind} defaultChecked={kind === "percent"} label={t(`admin.coupons.kinds.${kind}`)} />
            ))}
          </fieldset>
          <Field label={t("admin.coupons.value")} hint={t("admin.coupons.valueHelp")}>
            <TextInput name="value" required inputMode="decimal" autoComplete="off" />
          </Field>
          <fieldset>
            <legend>{t("admin.coupons.duration")}</legend>
            {DURATIONS.map((duration) => (
              <Radio key={duration} name="duration" value={duration} defaultChecked={duration === "once"} label={t(`admin.coupons.durations.${duration}`)} />
            ))}
          </fieldset>
          <Field label={t("admin.coupons.durationInMonths")} hint={t("admin.coupons.durationInMonthsHelp")}>
            <TextInput name="durationInMonths" type="number" min={1} max={36} />
          </Field>
          <fieldset aria-describedby="new-coupon-plans-help">
            <legend>{t("admin.coupons.plans")}</legend>
            <p id="new-coupon-plans-help" className="section-meta">
              {t("admin.coupons.plansHelp")}
            </p>
            {plans.map((plan) => (
              <Checkbox key={plan.key} name="plans" value={plan.key} label={plan.name[locale]} />
            ))}
          </fieldset>
          <Field label={t("admin.coupons.expiresAt")} hint={t("admin.coupons.expiresAtHelp")}>
            <TextInput name="expiresAt" type="date" />
          </Field>
          <Field label={t("admin.coupons.maxRedemptions")} hint={t("admin.coupons.maxRedemptionsHelp")}>
            <TextInput name="maxRedemptions" type="number" min={1} />
          </Field>
          <Checkbox name="firstPaymentOnly" label={t("admin.coupons.firstPaymentOnlyLabel")} hint={t("admin.coupons.firstPaymentOnlyHelp")} />
          <button className={buttonClass({ variant: "primary" })} type="submit">
            {t("admin.coupons.create")}
          </button>
        </div>
      </Card>
    </form>
  );
}
