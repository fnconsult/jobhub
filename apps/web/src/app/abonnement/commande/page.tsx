import { FREE_PLAN } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { AccountSections } from "@/components/AccountSections";
import { OrderForm } from "@/components/OrderForm";
import { Note } from "@/design/Note";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getOrders } from "@/orders/server";
import { ORDER_ACTIONS, ORDER_CGV_ERROR, ORDER_PARAMS, routes } from "@/routes";
import "../abonnement.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("orders.page.title")} · ${t("app.name")}` };
}

/** The longest code a shared link may carry (a Coupon's code is at most 40 characters). */
const MAX_CODE_LENGTH = 40;

/**
 * The Order page for a paid Plan (#512), between « Choisir l'offre … » and Stripe Checkout: the summary, the CGV box and
 * the Immediate Performance Request (OrderForm). A shared link's code is carried on. A Candidate who already pays is
 * sent to the Stripe customer portal to change Plan (ADR-0014), without this page.
 */
export default async function PlanOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const query = await searchParams;
  const one = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : "");
  const plan = one(ORDER_PARAMS.plan);
  const code = one(ORDER_PARAMS.code).trim().slice(0, MAX_CODE_LENGTH);
  const billing = getBilling();
  if ((await billing.entitlements(candidate.id)).plan !== FREE_PLAN) {
    redirect((await billing.openCustomerPortal(candidate.id, locale)) ?? routes.subscription);
  }
  const terms = await getOrders().terms(candidate.id, { kind: "plan", plan });

  return (
    <AccountSections candidateId={candidate.id}>
      <div className="subscription order">
        <h2>{t("orders.page.title")}</h2>
        {terms ? (
          <OrderForm
            terms={terms}
            action={ORDER_ACTIONS.plan}
            hidden={{ plan }}
            code={code || null}
            back={code ? `${routes.subscription}?${new URLSearchParams({ code })}` : routes.subscription}
            error={one(ORDER_PARAMS.error) === ORDER_CGV_ERROR}
            locale={locale}
            t={t}
          />
        ) : (
          <Note tone="warn" role="status">
            <p>{t("orders.page.nothing")}</p>
            <Link href={routes.subscription}>{t("withdrawals.page.back")}</Link>
          </Note>
        )}
      </div>
    </AccountSections>
  );
}
