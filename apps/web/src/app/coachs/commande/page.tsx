import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { OrderForm } from "@/components/OrderForm";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getOrders } from "@/orders/server";
import { ORDER_ACTIONS, ORDER_CGV_ERROR, ORDER_PARAMS, routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("orders.page.title")} · ${t("app.name")}` };
}

/**
 * The Order page for a Coaching Session (#512), between « Réserver une séance avec … » and Stripe Checkout: the summary
 * (the Human Coach, the Candidate's Coaching Session Price), the CGV box and the Immediate Performance Request, which
 * here also says the right of withdrawal is lost once the session has taken place (L221-28 1°).
 */
export default async function CoachingOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const query = await searchParams;
  const coachId = typeof query[ORDER_PARAMS.coach] === "string" ? (query[ORDER_PARAMS.coach] as string) : "";
  const terms = await getOrders()
    .terms(candidate.id, { kind: "coachingSession", coachId })
    .catch((cause: unknown) => {
      console.error("[orders] Coaching Session order unavailable", cause);
      return null;
    });

  return (
    <CandidateLayout candidateId={candidate.id} title={t("orders.page.title")}>
      <div className="order">
        {terms ? (
          <OrderForm
            terms={terms}
            action={ORDER_ACTIONS.coachingSession}
            hidden={{ coachId }}
            back={routes.coaching}
            error={query[ORDER_PARAMS.error] === ORDER_CGV_ERROR}
            locale={locale}
            t={t}
          />
        ) : (
          <div className="notice" role="status">
            <p>{t("orders.page.nothing")}</p>
            <Link href={routes.coaching}>{t("orders.page.back")}</Link>
          </div>
        )}
      </div>
    </CandidateLayout>
  );
}
