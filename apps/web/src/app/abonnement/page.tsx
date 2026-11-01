import { FREE_PLAN, WEEKLY_QUOTAS } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { PROMOTION_CODE_REFUSALS, type PromotionCodeRefusal } from "@/billing";
import { codeNotice } from "@/billing/code-notice";
import { activeDiscountLabel } from "@/billing/coupon-label";
import { currentPlanLabel } from "@/billing/current-plan";
import { paymentFailedNotice } from "@/billing/payment-failed-notice";
import { planCards, type PlanCard } from "@/billing/plan-cards";
import { getBilling } from "@/billing/server";
import { quotaBar } from "@/billing/usage-meter";
import { AccountSections } from "@/components/AccountSections";
import { PaymentFailedNotice } from "@/components/PaymentFailedNotice";
import { QuotaReductionNotice } from "@/components/QuotaReductionNotice";
import { RefreshUntilPlanConfirmed } from "@/components/RefreshUntilPlanConfirmed";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getQuotaReductions } from "@/quota-reductions/server";
import { ORDER_PARAMS, PLAN_ORDER, routes } from "@/routes";
import { getWithdrawals } from "@/withdrawals/server";
import "./abonnement.css";

type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("billing.page.title")} · ${t("app.name")}` };
}

/** How a card marks what a Plan includes, and what it does not: decoration, the words say it. */
const INCLUDED_MARK = "✓";
const MISSING_MARK = "—";
/** Each Plan's card is an article, one of the comparison's. */
const CARD_ELEMENT = "article";

/** The longest code a shared link may carry (a Coupon's code is at most 40 characters). */
const MAX_CODE_LENGTH = 40;

/**
 * Mon compte's Subscription Section (ADR-0024), at its own address, in the Design System (#469): the Candidate's Plan
 * (and the discount their subscription gets) with the way to Stripe (and their invoices there), this week's usage as
 * bars, red once used up, the failed-payment Note, a Quota Reduction they may cancel over (#514), the offered Plans as comparison cards in rank order with their
 * prices (« Votre offre », « Conseillée »), and, on Free, a promotion code to check. A paid Plan whose cancellation is
 * not scheduled has « Résilier votre contrat » beside the way to Stripe (#513); back from confirming it, a Note says it
 * is recorded until when, and whether its acknowledgement was emailed.
 * A hidden Plan is not compared, even the Candidate's. A shared link's `?code=` is checked and carried
 * to Checkout, where it applies to the Plans it is for; checkout works without it all the same.
 */
export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ checkout?: string; error?: string; code?: string | string[]; codeRefused?: string; plan?: string; resiliation?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { checkout, error, code: codeParam, codeRefused, plan: refusedPlan, resiliation } = await searchParams;
  const code = typeof codeParam === "string" ? codeParam.trim().slice(0, MAX_CODE_LENGTH) : "";
  const billing = getBilling();
  const [{ plan, stripeStatus, endsAt, quotas, usedThisWeek }, plans, allQuotas, prices, hasInvoices, discount, withdrawable, reduction] = await Promise.all([
    billing.entitlements(candidate.id),
    billing.plans(),
    billing.planQuotas(),
    billing.planPrices(),
    billing.hasInvoices(candidate.id),
    billing.activeDiscount(candidate.id),
    getWithdrawals().contracts(candidate.id),
    getQuotaReductions().openFor(candidate.id),
  ]);
  // « Renoncer au contrat ici » (#511): for 14 days after the subscription started.
  const planWithdrawal = withdrawable.find((contract) => contract.kind === "plan");
  const offeredKeys = plans.filter((each) => each.status === "offered" && each.key !== FREE_PLAN).map((each) => each.key);
  // Sent back from Checkout, which refused the code for that Plan: say why, and offer to go on without it.
  const refusal =
    code && PROMOTION_CODE_REFUSALS.includes(codeRefused as PromotionCodeRefusal) && offeredKeys.includes(refusedPlan ?? "")
      ? { reason: codeRefused as PromotionCodeRefusal, plan: refusedPlan! }
      : null;
  // A code only applies to a new subscription, from Free: there is no Checkout otherwise.
  const promotion = code && plan === FREE_PLAN && !refusal ? await billing.checkPromotionCode(code, candidate.id) : null;
  const notice = code ? codeNotice({ plan, plans, promotion, refusal, locale }) : null;
  // Carried to Checkout when it may apply (or could not be checked here): Checkout says if it does not.
  const carriedCode = code && plan === FREE_PLAN && !refusal && (promotion === null || notice?.role === "status") ? code : null;
  const planName = plans.find((each) => each.key === plan)?.name ?? { fr: plan, en: plan };
  const paymentFailed = paymentFailedNotice(stripeStatus, locale);
  // « Résilier votre contrat » (#513): on a paid Plan, until its cancellation is scheduled (here or in Stripe's portal).
  const cancellable = plan !== FREE_PLAN && !endsAt;
  const cancelled = endsAt && (resiliation === "enregistree" || resiliation === "sans-accuse") ? { endsAt, acknowledged: resiliation === "enregistree" } : null;

  const cards = planCards({ plans, current: plan, quotas: allQuotas, prices, locale });
  const shownWeekly = WEEKLY_QUOTAS.filter((quota) => quotas[quota] !== 0);

  return (
    <AccountSections candidateId={candidate.id}>
      <div className="subscription">
        <h2>{t("billing.page.title")}</h2>
        {checkout === "success" ? (
          <Note tone="success" role="status">
            {t("billing.page.checkoutSuccess")}
          </Note>
        ) : null}
        {/* Checkout is only offered on Free: until Stripe's webhook moves the Candidate off it, keep looking. */}
        {checkout === "success" && plan === FREE_PLAN ? <RefreshUntilPlanConfirmed /> : null}
        {error ? (
          <Note tone="danger" role="alert">
            {t(error === "unavailable" ? "billing.page.unavailable" : "billing.page.error")}
          </Note>
        ) : null}
        {notice ? (
          <Note tone={notice.role === "status" ? "info" : "warn"} role={notice.role}>
            <p>{notice.text}</p>
            {refusal ? (
              <form method="get" action={PLAN_ORDER}>
                <input type="hidden" name={ORDER_PARAMS.plan} value={refusal.plan} />
                <button className={buttonClass({ variant: "primary" })} type="submit">
                  {t("billing.page.continueWithoutCode", { plan: plans.find((each) => each.key === refusal.plan)?.name[locale] ?? refusal.plan })}
                </button>
              </form>
            ) : null}
          </Note>
        ) : null}
        {cancelled ? (
          <Note tone="success" role="status">
            <p>{t("billing.cancellation.done", { plan: planName[locale], date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(cancelled.endsAt) })}</p>
            <p>{t(cancelled.acknowledged ? "billing.cancellation.receiptSent" : "billing.cancellation.receiptNotSent")}</p>
          </Note>
        ) : null}
        {paymentFailed ? <PaymentFailedNotice notice={paymentFailed} /> : null}
        {/* A Quota Reduction they were told of (#514): they may cancel at no cost over it, refunded prorata. */}
        {reduction ? (
          <QuotaReductionNotice reduction={reduction} locale={locale} t={t}>
            <a className={buttonClass()} href={routes.subscriptionQuotaReduction}>
              {t("quotaReduction.resolve")}
            </a>
          </QuotaReductionNotice>
        ) : null}

        <div className="subscription-summary">
          <Card>
            <p className="subscription-current">{currentPlanLabel({ planName, endsAt }, locale)}</p>
            {discount ? <p className="subscription-discount">{activeDiscountLabel(discount, locale)}</p> : null}
            {plan !== FREE_PLAN || hasInvoices ? (
              <div className="subscription-stripe">
                {plan !== FREE_PLAN ? (
                  <form method="post" action="/api/billing/portal">
                    <button className={buttonClass({ variant: "primary" })} type="submit">
                      {t("billing.page.manage")}
                    </button>
                  </form>
                ) : null}
                {cancellable ? (
                  <Link className={buttonClass()} href={routes.subscriptionCancellation}>
                    {t("billing.cancellation.action")}
                  </Link>
                ) : null}
                {hasInvoices ? (
                  <form method="post" action="/api/billing/portal">
                    <button className={buttonClass()} type="submit">
                      {t("billing.page.invoices")}
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
            {plan !== FREE_PLAN ? <p className="subscription-help">{t("billing.page.manageHelp")}</p> : null}
            {hasInvoices ? <p className="subscription-help">{t("billing.page.invoicesHelp")}</p> : null}
            {planWithdrawal ? (
              <div className="subscription-withdrawal">
                <p>{t("withdrawals.subscription.offer", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(planWithdrawal.deadline.getTime() - 1)) })}</p>
                <Link className={buttonClass()} href={routes.withdrawal(planWithdrawal.ref)}>
                  {t("withdrawals.page.title")}
                </Link>
              </div>
            ) : null}
          </Card>

          <Card title={t("billing.page.usageTitle")} headingLevel={3}>
            <dl className="subscription-usage">
              {shownWeekly.map((quota) => {
                const limit = quotas[quota];
                const bar = quotaBar({ used: usedThisWeek[quota], limit });
                const label = t(`billing.quotas.${quota}`);
                const value = limit === null ? t("billing.page.usageUnlimited", { used: usedThisWeek[quota] }) : t("billing.page.usage", { used: usedThisWeek[quota], limit });
                return (
                  <div key={quota} data-used-up={bar.usedUp || undefined}>
                    <dt>{label}</dt>
                    <dd>
                      <span className="subscription-usage-value">{value}</span>
                      {bar.percent === null ? null : (
                        <span
                          className="subscription-usage-bar"
                          role="progressbar"
                          aria-label={label}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={bar.percent}
                          aria-valuetext={value}
                        >
                          <span style={{ width: `${bar.percent}%` }} />
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>
        </div>

        <section className="subscription-plans" aria-labelledby="subscription-plans-title">
          <h3 id="subscription-plans-title">{t("billing.page.comparisonTitle")}</h3>
          <ul className="plan-cards">
            {cards.map((card) => (
              <li key={card.key} className="plan-card" data-plan={card.key} data-current={card.current || undefined}>
                <PlanCardView card={card} carriedCode={carriedCode} t={t} />
              </li>
            ))}
          </ul>
        </section>

        {/* A code only applies to a new subscription, from Free: it is checked here, then carried to Checkout. */}
        {plan === FREE_PLAN ? (
          <form className="subscription-code" method="get" action={routes.subscription}>
            <Field label={t("billing.page.codeLabel")} hint={t("billing.page.codeHint")}>
              <TextInput name="code" defaultValue={code} maxLength={MAX_CODE_LENGTH} autoComplete="off" spellCheck={false} />
            </Field>
            <button className={buttonClass()} type="submit">
              {t("billing.page.applyCode")}
            </button>
          </form>
        ) : null}
      </div>
    </AccountSections>
  );
}

/**
 * One Plan of the comparison, on a card: its name, « Votre offre » on the Candidate's and « Conseillée » on the one
 * above it, its price, what it includes (each quota and what the Plan gives of it, the missing ones dimmed), and, from
 * Free, the button to its Order page (#512) and then Checkout, carrying a promotion code that may apply.
 */
function PlanCardView({ card, carriedCode, t }: { card: PlanCard; carriedCode: string | null; t: T }) {
  const pill = card.current ? <Pill tone="accent">{t("billing.page.current")}</Pill> : card.recommended ? <Pill tone="accent">{t("billing.page.recommended")}</Pill> : null;
  return (
    <Card as={CARD_ELEMENT} headingId={`plan-${card.key}-title`} headingLevel={3} title={card.name} actions={pill}>
      {card.price ? <p className="plan-card-price">{card.price}</p> : null}
      <ul className="plan-card-quotas">
        {card.quotas.map((line) => (
          <li key={line.quota} data-included={line.included ? undefined : "false"}>
            <span className="plan-card-mark" aria-hidden="true">
              {line.included ? INCLUDED_MARK : MISSING_MARK}
            </span>
            <span className="plan-card-quota">{line.label}</span> <span className="plan-card-value">{line.value}</span>
          </li>
        ))}
      </ul>
      {/* To the Order page (#512): its summary and boxes come before Stripe Checkout. */}
      {card.checkout ? (
        <form method="get" action={PLAN_ORDER}>
          <input type="hidden" name={ORDER_PARAMS.plan} value={card.key} />
          {/* Carried to Checkout even when unchecked here: billing applies it only where it can. */}
          {carriedCode ? <input type="hidden" name={ORDER_PARAMS.code} value={carriedCode} /> : null}
          <button className={buttonClass({ variant: card.recommended ? "primary" : "secondary" })} type="submit">
            {t("billing.page.choose", { plan: card.name })}
          </button>
        </form>
      ) : null}
    </Card>
  );
}
