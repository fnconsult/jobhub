import { LEGAL_TEXT_ANCHORS } from "@jobhub/help";
import { createI18n, type Locale } from "@jobhub/shared/i18n";
import type { BillingInterval } from "../billing";
import { renderEmail, type RenderedEmail } from "../emails";
import { versionDay } from "../public-pages/days";
import { money } from "../withdrawals/email";

const ZONE = { timeZone: "Europe/Paris" } as const;

/** The CGV's section holding the model withdrawal form, in every version (LEGAL_TEXT_ANCHORS, #511). */
const WITHDRAWAL_FORM_ANCHOR = LEGAL_TEXT_ANCHORS.cgv[0];

/** What the Order Confirmation says of an Order Stripe confirmed. */
export interface OrderConfirmation {
  kind: "plan" | "coachingSession";
  /** The Plan's name in this language, or the Human Coach's. */
  subject: string;
  paidAt: Date;
  /** What Stripe took (0 when a 100 % code left nothing to pay). */
  paid: { amount: number; currency: string };
  /** The price the Order page showed, all taxes included, each `interval` for a Plan; null when it was not known. */
  price: { amount: number; currency: string; interval: BillingInterval | null } | null;
  /** The CGV version accepted, at its permanent address; null when none was in effect. */
  cgv: { version: string; url: string } | null;
  immediateExecutionRequested: boolean;
  /** « Renoncer au contrat ici », and the first instant past the Withdrawal period. */
  withdrawal: { url: string; until: Date };
}

/**
 * The Order Confirmation, on a durable medium (C. conso. L221-13, #512): the summary of what was bought, the permanent
 * link to the CGV version accepted, the Immediate Performance Request and what it means at a Withdrawal, and where
 * « Renoncer au contrat ici » is, until when, and the model withdrawal form: the CGV version's own section.
 */
export function orderConfirmationEmail(order: OrderConfirmation, language: Locale): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const at = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short", ...ZONE }).format(order.paidAt);
  // The deadline is the first instant past the period: its last day is the day before.
  const lastDay = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", ...ZONE }).format(new Date(order.withdrawal.until.getTime() - 1));
  const plan = order.kind === "plan";
  const title = plan ? t("orders.email.plan", { plan: order.subject }) : t("orders.email.coachingSession", { coach: order.subject });
  const price = order.price ? orderPriceLabel(order.price, language) : null;
  return renderEmail({
    language,
    subject: plan ? t("orders.email.subjectPlan", { plan: order.subject }) : t("orders.email.subjectSession", { coach: order.subject }),
    title: t("orders.email.title"),
    body: [
      t("orders.email.intro", { at }),
      {
        card: {
          title,
          details: [
            ...(price ? [t("orders.email.price", { price })] : []),
            t("orders.email.paid", { amount: money(order.paid.amount, order.paid.currency, i18n.language) }),
            !plan ? t("orders.renewal.session") : order.price?.interval ? t("orders.renewal.plan", { every: t(`orders.every.${order.price.interval}`) }) : t("orders.renewal.planUnknown"),
          ],
        },
      },
      ...(order.cgv ? [t("orders.email.cgv", { date: versionDay(order.cgv.version, language), url: order.cgv.url })] : []),
      order.immediateExecutionRequested ? t(plan ? "orders.email.immediatePlan" : "orders.email.immediateSession") : t("orders.email.notImmediate"),
      t(plan ? "orders.email.withdrawalPlan" : "orders.email.withdrawalSession", { date: lastDay, url: order.withdrawal.url }),
      // The model withdrawal form is a section of every CGV version (LEGAL_TEXT_ANCHORS): none to link to without one.
      ...(order.cgv ? [t("orders.email.withdrawalForm", { url: `${order.cgv.url}#${WITHDRAWAL_FORM_ANCHOR}` })] : []),
      t("orders.email.keep"),
    ],
    footer: { reason: t("orders.email.reason") },
  });
}

/** « 19,00 € TTC par mois », « 90,00 € TTC »: a price as the Order page and its confirmation write it. */
export function orderPriceLabel(price: { amount: number; currency: string; interval: BillingInterval | null }, language: Locale): string {
  const i18n = createI18n(language);
  const amount = money(price.amount, price.currency, i18n.language);
  return price.interval ? i18n.t("orders.pricePer", { price: amount, per: i18n.t(`orders.per.${price.interval}`) }) : i18n.t("orders.priceOnce", { price: amount });
}
