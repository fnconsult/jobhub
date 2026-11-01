import type { Locale } from "@jobhub/shared/i18n";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import type { getServerT } from "@/i18n/server";
import { IMMEDIATE_EXECUTION_REQUESTED, ORDER_FIELDS, type OrderTerms } from "@/orders";
import { orderPriceLabel } from "@/orders/email";
import { versionDay } from "@/public-pages/days";
import "./OrderForm.css";

type T = Awaited<ReturnType<typeof getServerT>>;

/**
 * The Order page's body (#512, C. civ. 1127-2): the summary (what is bought, its price all taxes included, how often a
 * Plan is charged and that it renews), then two separate boxes, never ticked for the Candidate: « J'accepte les CGV »
 * with a link to the version (only while one is in effect), and the Immediate Performance Request, optional, whose hint
 * says what it changes. « Passer au paiement » posts to `action`, which checks them; `hidden` carries what is ordered.
 * In English, the CGV are a translation: the French text prevails.
 */
export function OrderForm({
  terms,
  action,
  hidden,
  code,
  back,
  error,
  locale,
  t,
}: {
  terms: OrderTerms;
  action: string;
  hidden: Record<string, string>;
  /** A shared link's code, carried to Checkout. */
  code?: string | null;
  back: string;
  /** Sent back over the CGV box, not ticked. */
  error: boolean;
  locale: Locale;
  t: T;
}) {
  const { summary, cgv } = terms;
  const plan = summary.kind === "plan";
  const date = cgv ? versionDay(cgv.version, locale) : "";
  const renewal = !plan ? t("orders.renewal.session") : summary.price?.interval ? t("orders.renewal.plan", { every: t(`orders.every.${summary.price.interval}`) }) : t("orders.renewal.planUnknown");
  return (
    <>
      <p>{t("orders.page.intro")}</p>
      {error && cgv ? (
        <Note tone="danger" role="alert">
          {t("orders.page.cgvRequired")}
        </Note>
      ) : null}
      <Card title={t("orders.page.summaryTitle")} headingLevel={plan ? 3 : 2}>
        <Properties>
          <Property term={t("orders.page.item")}>{plan ? t("orders.email.plan", { plan: summary.subject[locale] }) : t("orders.email.coachingSession", { coach: summary.subject[locale] })}</Property>
          <Property term={t("orders.page.price")}>{summary.price ? orderPriceLabel(summary.price, locale) : t("orders.page.priceUnknown")}</Property>
          <Property term={t("orders.page.renewal")}>{renewal}</Property>
          {code ? <Property term={t("orders.page.code")}>{t("orders.page.codeCarried", { code })}</Property> : null}
        </Properties>
      </Card>
      <form className="order-form" method="post" action={action}>
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {code ? <input type="hidden" name="code" value={code} /> : null}
        {cgv ? (
          <div className="order-cgv">
            {locale !== "fr" ? <Note>{t("legal.translation")}</Note> : null}
            <p>
              <a href={cgv.url} target="_blank" rel="noopener">
                {t("orders.page.readCgv", { date })}
              </a>
            </p>
            <Checkbox name={ORDER_FIELDS.cgv} value={cgv.version} label={t("orders.page.cgvBox", { date })} required />
          </div>
        ) : null}
        <Checkbox
          name={ORDER_FIELDS.immediateExecution}
          value={IMMEDIATE_EXECUTION_REQUESTED}
          label={t(plan ? "orders.page.immediatePlan" : "orders.page.immediateSession")}
          hint={t("orders.page.immediateHint")}
        />
        <p className="order-withdrawal">{t("orders.page.withdrawal")}</p>
        <div className="order-actions">
          <button className={buttonClass({ variant: "primary" })} type="submit">
            {t("orders.page.submit")}
          </button>
          <Link className={buttonClass({ variant: "quiet" })} href={back}>
            {t("orders.page.back")}
          </Link>
        </div>
      </form>
    </>
  );
}
