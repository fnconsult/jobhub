import { APP_COACHING_PAYMENT_PATH, APP_PAYMENT_CANCELLED, APP_SCHEME } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { PublicSite } from "@/design/PublicSite";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("coachingPayment.title")} · ${t("app.name")}`, robots: { index: false } };
}

/**
 * Where Stripe Checkout sends back a Candidate who pays a Coaching Session from the app (#694): an address the app
 * claims by a universal link (APP_COACHING_PAYMENT_PATH), so with the app installed the system opens it there. Opened in
 * a browser instead (the in-app browser may keep it), a public page that holds no one's data: back to the app by its
 * scheme, or Mes coachs humains on the web. It says nothing was recorded: Stripe's signed webhook records the Coaching
 * Session (ADR-0016). `?annule=1`: the Candidate left Checkout without paying.
 */
export default async function CoachingPaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getServerT();
  const cancelled = (await searchParams)[APP_PAYMENT_CANCELLED] !== undefined;
  const backToApp = `${APP_SCHEME}:/${APP_COACHING_PAYMENT_PATH}${cancelled ? `?${APP_PAYMENT_CANCELLED}=1` : ""}`;
  return (
    <PublicSite>
      <main id="main" className="ds-site__page ds-site__narrow">
        <h1 className="ds-site__title">{t(cancelled ? "coachingPayment.cancelledTitle" : "coachingPayment.title")}</h1>
        <p>{t(cancelled ? "coachingPayment.cancelledBody" : "coachingPayment.body")}</p>
        <div>
          <a className={buttonClass({ variant: "primary" })} href={backToApp}>
            {t("coachingPayment.backToApp")}
          </a>
        </div>
        <p>
          <Link href={routes.coaching}>{t("coachingPayment.onWeb")}</Link>
        </p>
      </main>
    </PublicSite>
  );
}
