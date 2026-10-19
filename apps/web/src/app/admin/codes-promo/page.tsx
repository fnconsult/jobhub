import { FREE_PLAN } from "@jobhub/shared";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { couponFromForm } from "@/admin/coupon-form";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import type { Coupon, CouponError, PlanDefinition } from "@/billing";
import { couponTermsLabel } from "@/billing/coupon-label";
import { getBilling } from "@/billing/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

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
      <p className="lead">{t("admin.coupons.intro")}</p>
      {canWrite ? null : <p className="notice">{t("admin.readOnly")}</p>}
      {createdCoupon ? (
        <p className="notice" role="status">
          {t("admin.coupons.created", { code: createdCoupon.code })}
        </p>
      ) : null}
      {deactivatedCoupon ? (
        <p className="notice" role="status">
          {t("admin.coupons.deactivated", { code: deactivatedCoupon.code })}
        </p>
      ) : null}
      {isError(error) ? (
        <p className="notice" role="alert">
          {t(`admin.coupons.errors.${error}`)}
        </p>
      ) : null}

      {coupons === null ? (
        <p className="notice" role="alert">
          {t("admin.coupons.unavailable")}
        </p>
      ) : coupons.length === 0 ? (
        <p>{t("admin.coupons.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.coupons.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.coupons.code")}</th>
                <th scope="col">{t("admin.coupons.terms")}</th>
                <th scope="col">{t("admin.coupons.plans")}</th>
                <th scope="col">{t("admin.coupons.expiresAt")}</th>
                <th scope="col">{t("admin.coupons.redemptions")}</th>
                <th scope="col">{t("admin.coupons.statusLabel")}</th>
                <th scope="col">{t("admin.coupons.link")}</th>
                {canWrite ? <td /> : null}
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) =>
                "unreadable" in coupon ? (
                  <tr key={coupon.id}>
                    <th scope="row">
                      <code>{coupon.code}</code>
                    </th>
                    <td colSpan={canWrite ? 7 : 6}>{t("admin.coupons.unreadable")}</td>
                  </tr>
                ) : (
                <tr key={coupon.id}>
                  <th scope="row">
                    <code>{coupon.code}</code>
                  </th>
                  <td>
                    {couponTermsLabel(coupon, locale)}
                    {coupon.firstPaymentOnly ? ` (${t("admin.coupons.firstPaymentOnly")})` : null}
                  </td>
                  <td>{planNames(coupon)}</td>
                  <td>{coupon.expiresAt ? date.format(coupon.expiresAt) : t("admin.coupons.noExpiry")}</td>
                  <td>
                    {coupon.maxRedemptions === null
                      ? coupon.timesRedeemed
                      : t("admin.coupons.redemptionsOf", { used: coupon.timesRedeemed, max: coupon.maxRedemptions })}
                  </td>
                  <td>{t(`admin.coupons.status.${coupon.active ? "active" : "inactive"}`)}</td>
                  <td>
                    <code>{`${routes.subscription}?code=${encodeURIComponent(coupon.code)}`}</code>
                  </td>
                  {canWrite ? (
                    <td>
                      {coupon.active ? (
                        <form action={deactivateCoupon}>
                          <input type="hidden" name="coupon" value={coupon.id} />
                          <button className="button" type="submit">
                            {t("admin.coupons.deactivate", { code: coupon.code })}
                          </button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {canWrite ? <p>{t("admin.coupons.deactivateHelp")}</p> : null}

      {canWrite ? <CreateCouponForm plans={sold} locale={locale} t={t} /> : null}
    </BackOfficeLayout>
  );
}

function CreateCouponForm({ plans, locale, t }: { plans: PlanDefinition[]; locale: "fr" | "en"; t: Awaited<ReturnType<typeof getServerT>> }) {
  return (
    <form className="stack quota-form" action={createCoupon}>
      <fieldset>
        <legend>
          <h2>{t("admin.coupons.createTitle")}</h2>
        </legend>
        <p>{t("admin.coupons.createHelp")}</p>
        <div className="stack">
          <label htmlFor="new-coupon-code">{t("admin.coupons.code")}</label>
          <input
            id="new-coupon-code"
            className="input"
            name="code"
            required
            pattern="[A-Za-z0-9_\-]{3,40}"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="new-coupon-code-help"
          />
          <p id="new-coupon-code-help">{t("admin.coupons.codeHelp")}</p>
        </div>
        <fieldset className="stack">
          <legend>{t("admin.coupons.kind")}</legend>
          {KINDS.map((kind) => (
            <div key={kind} className="checkbox-field">
              <input id={`new-coupon-kind-${kind}`} type="radio" name="kind" value={kind} defaultChecked={kind === "percent"} />
              <label htmlFor={`new-coupon-kind-${kind}`}>{t(`admin.coupons.kinds.${kind}`)}</label>
            </div>
          ))}
        </fieldset>
        <div className="stack">
          <label htmlFor="new-coupon-value">{t("admin.coupons.value")}</label>
          <input id="new-coupon-value" className="input" name="value" required inputMode="decimal" autoComplete="off" aria-describedby="new-coupon-value-help" />
          <p id="new-coupon-value-help">{t("admin.coupons.valueHelp")}</p>
        </div>
        <fieldset className="stack">
          <legend>{t("admin.coupons.duration")}</legend>
          {DURATIONS.map((duration) => (
            <div key={duration} className="checkbox-field">
              <input id={`new-coupon-duration-${duration}`} type="radio" name="duration" value={duration} defaultChecked={duration === "once"} />
              <label htmlFor={`new-coupon-duration-${duration}`}>{t(`admin.coupons.durations.${duration}`)}</label>
            </div>
          ))}
        </fieldset>
        <div className="stack">
          <label htmlFor="new-coupon-months">{t("admin.coupons.durationInMonths")}</label>
          <input id="new-coupon-months" className="input" name="durationInMonths" type="number" min={1} max={36} aria-describedby="new-coupon-months-help" />
          <p id="new-coupon-months-help">{t("admin.coupons.durationInMonthsHelp")}</p>
        </div>
        <fieldset className="stack" aria-describedby="new-coupon-plans-help">
          <legend>{t("admin.coupons.plans")}</legend>
          <p id="new-coupon-plans-help">{t("admin.coupons.plansHelp")}</p>
          {plans.map((plan) => (
            <div key={plan.key} className="checkbox-field">
              <input id={`new-coupon-plan-${plan.key}`} type="checkbox" name="plans" value={plan.key} />
              <label htmlFor={`new-coupon-plan-${plan.key}`}>{plan.name[locale]}</label>
            </div>
          ))}
        </fieldset>
        <div className="stack">
          <label htmlFor="new-coupon-expires">{t("admin.coupons.expiresAt")}</label>
          <input id="new-coupon-expires" className="input" name="expiresAt" type="date" aria-describedby="new-coupon-expires-help" />
          <p id="new-coupon-expires-help">{t("admin.coupons.expiresAtHelp")}</p>
        </div>
        <div className="stack">
          <label htmlFor="new-coupon-max">{t("admin.coupons.maxRedemptions")}</label>
          <input id="new-coupon-max" className="input" name="maxRedemptions" type="number" min={1} aria-describedby="new-coupon-max-help" />
          <p id="new-coupon-max-help">{t("admin.coupons.maxRedemptionsHelp")}</p>
        </div>
        <div className="checkbox-field">
          <input id="new-coupon-first" type="checkbox" name="firstPaymentOnly" aria-describedby="new-coupon-first-help" />
          <label htmlFor="new-coupon-first">{t("admin.coupons.firstPaymentOnlyLabel")}</label>
          <p id="new-coupon-first-help">{t("admin.coupons.firstPaymentOnlyHelp")}</p>
        </div>
        <button className="button button-primary" type="submit">
          {t("admin.coupons.create")}
        </button>
      </fieldset>
    </form>
  );
}
