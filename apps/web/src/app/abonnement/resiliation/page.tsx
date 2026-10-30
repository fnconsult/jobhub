import { FREE_PLAN } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import type { CancellationTerms } from "@/billing";
import { getBilling } from "@/billing/server";
import { AccountSections } from "@/components/AccountSections";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import "../abonnement.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("billing.cancellation.title")} · ${t("app.name")}` };
}

/**
 * « Résilier votre contrat » (#513, C. conso. L215-1-1, D215-1): the second of the three clicks from the subscription
 * page. The Plan, the end of the contract (the end of the paid period, read from Stripe), that the Plan is kept until
 * then and nothing more is charged, and « Confirmer la résiliation ». No questionnaire, no offer standing in the way.
 * With nothing to cancel (Free, or a cancellation already scheduled), says so and leads back.
 */
export default async function CancellationPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const billing = getBilling();
  let terms: CancellationTerms | null;
  let failed = false;
  try {
    terms = await billing.cancellationTerms(candidate.id);
  } catch (error) {
    console.error("[billing] could not read the subscription to cancel from Stripe", error);
    terms = null;
    failed = true;
  }
  const endsOn = terms ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(terms.endsAt) : "";
  const free = (await billing.plans()).find((plan) => plan.key === FREE_PLAN)?.name[locale] ?? "";

  return (
    <AccountSections candidateId={candidate.id}>
      <div className="subscription cancellation">
        <h2>{t("billing.cancellation.title")}</h2>
        {terms ? (
          <>
            <p>{t("billing.cancellation.intro")}</p>
            <Card title={t("billing.cancellation.contractTitle")} headingLevel={3}>
              <Properties>
                <Property term={t("billing.cancellation.plan")}>{terms.planName[locale]}</Property>
                <Property term={t("billing.cancellation.endsAt")}>{endsOn}</Property>
              </Properties>
            </Card>
            <p>{t("billing.cancellation.keep", { plan: terms.planName[locale], date: endsOn, free })}</p>
            <p>{t("billing.cancellation.receipt")}</p>
            <form className="cancellation-actions" method="post" action="/api/billing/cancellation">
              <button className={buttonClass({ variant: "primary" })} type="submit">
                {t("billing.cancellation.confirm")}
              </button>
              <Link className={buttonClass({ variant: "quiet" })} href={routes.subscription}>
                {t("billing.cancellation.back")}
              </Link>
            </form>
          </>
        ) : (
          <Note tone={failed ? "danger" : "warn"} role={failed ? "alert" : "status"}>
            <p>{t(failed ? "billing.page.error" : "billing.cancellation.nothing")}</p>
            <Link href={routes.subscription}>{t("billing.cancellation.backToSubscription")}</Link>
          </Note>
        )}
      </div>
    </AccountSections>
  );
}
