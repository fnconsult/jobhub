import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AccountSections } from "@/components/AccountSections";
import { QuotaReductionNotice } from "@/components/QuotaReductionNotice";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getQuotaReductions } from "@/quota-reductions/server";
import { routes } from "@/routes";
import "../abonnement.css";

/** What the page says once they cancelled: `?resiliation=faite`; `?erreur=1` when Stripe could not cancel. */
const DONE = "faite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("quotaReduction.page.confirmTitle")} · ${t("app.name")}` };
}

async function resolve() {
  "use server";
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  try {
    await getQuotaReductions().resolve(candidate.id);
  } catch (error) {
    // Stripe could not cancel: nothing has changed, they may try again.
    console.error("[quota-reductions] could not end a subscription over a Quota Reduction", error);
    redirect(`${routes.subscriptionQuotaReduction}?erreur=1`);
  }
  redirect(`${routes.subscriptionQuotaReduction}?resiliation=${DONE}`);
}

/**
 * Cancelling at no cost over a Quota Reduction the Candidate was told of (#514, L224-25-26), where the notice e-mail and
 * the Subscription Section lead: what changes, why, their right, and one button that ends the subscription now, the part
 * of the paid period not used refunded prorata. Afterwards, how much is refunded.
 */
export default async function QuotaReductionResolutionPage({ searchParams }: { searchParams: Promise<{ resiliation?: string; erreur?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { resiliation, erreur } = await searchParams;
  const reductions = getQuotaReductions();
  const done = resiliation === DONE ? await reductions.lastResolution(candidate.id) : null;
  const reduction = done ? null : await reductions.openFor(candidate.id);
  const amount = (refund: { amount: number; currency: string }) => new Intl.NumberFormat(locale, { style: "currency", currency: refund.currency }).format(refund.amount / 100);

  return (
    <AccountSections candidateId={candidate.id}>
      <div className="subscription">
        <h2>{t("quotaReduction.page.confirmTitle")}</h2>
        {erreur ? (
          <Note tone="danger" role="alert">
            {t("quotaReduction.page.error")}
          </Note>
        ) : null}
        {done ? (
          <Note tone="success" role="status">
            {done.refundPending ? t("quotaReduction.page.donePending") : done.refund ? t("quotaReduction.page.done", { amount: amount(done.refund) }) : t("quotaReduction.page.doneNothing")}
          </Note>
        ) : reduction ? (
          <QuotaReductionNotice reduction={reduction} locale={locale} t={t}>
            <form action={resolve} className="subscription-stripe">
              <button className={buttonClass({ variant: "danger" })} type="submit">
                {t("quotaReduction.page.confirm")}
              </button>
              <a className={buttonClass()} href={routes.subscription}>
                {t("quotaReduction.page.keep")}
              </a>
            </form>
          </QuotaReductionNotice>
        ) : (
          <Note tone="info">
            <p>{t("quotaReduction.page.notOpen")}</p>
            <a href={routes.subscription}>{t("billing.page.title")}</a>
          </Note>
        )}
      </div>
    </AccountSections>
  );
}
