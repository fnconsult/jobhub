import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { renderEmail, type RenderedEmail } from "../emails";

/** What the acknowledgement says of a cancellation, the Plans' names in the email's language. */
export interface CancellationReceipt {
  planName: string;
  /** The Free Plan's name: the Candidate's Plan once the contract ends. */
  freePlanName: string;
  requestedAt: Date;
  endsAt: Date;
  /** The subscription page, where a scheduled cancellation can be undone through Stripe. */
  subscriptionUrl: string;
}

const ZONE = { timeZone: "Europe/Paris" } as const;

/**
 * The acknowledgement of a cancellation, on a durable medium (C. conso. D215-2, #513): the date the request was
 * received, the date the contract ends, and what happens until then.
 */
export function cancellationReceiptEmail(receipt: CancellationReceipt, language: Locale): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const at = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short", ...ZONE }).format(receipt.requestedAt);
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", ...ZONE }).format(receipt.endsAt);
  return renderEmail({
    language,
    subject: t("billing.cancellation.email.subject"),
    title: t("billing.cancellation.email.title"),
    body: [
      t("billing.cancellation.email.intro", { at, plan: receipt.planName }),
      { card: { title: t("billing.cancellation.email.contract", { plan: receipt.planName }), details: [t("billing.cancellation.email.requestedAt", { at }), t("billing.cancellation.email.endsAt", { date: day })] } },
      t("billing.cancellation.keep", { plan: receipt.planName, date: day, free: receipt.freePlanName }),
      t("billing.cancellation.email.undo"),
      { action: { label: t("billing.cancellation.email.action"), url: receipt.subscriptionUrl } },
      t("billing.cancellation.email.keepThis"),
    ],
    footer: { reason: t("billing.cancellation.email.reason") },
  });
}
