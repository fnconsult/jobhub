import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { INTERVIEW_TIME_ZONE } from "../applications";
import { renderEmail, type RenderedEmail } from "../emails";

/** "19,00 €": an amount in the currency's smallest unit (cents), as the Interface Language writes it. */
export function money(amount: number, currency: string, language: string): string {
  return new Intl.NumberFormat(language, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

/** What the acknowledgement says of a Withdrawal. */
export interface WithdrawalReceipt {
  contract: "plan" | "coachingSession";
  /** The Plan's name in this language, or the Human Coach's. */
  subject: string;
  concludedAt: Date;
  paid: { amount: number; currency: string } | null;
  withdrawnAt: Date;
  name: string;
  /** What is refunded, in all; null when nothing was paid. */
  refunded: { amount: number; currency: string } | null;
  /** What is kept for the service already provided, at the Immediate Performance Request (#512); null when refunded in full. */
  kept?: { amount: number; currency: string } | null;
}

/**
 * The acknowledgement of a Withdrawal, on a durable medium (C. conso. L221-21 al. 3, D221-5): what was withdrawn from,
 * the date and time it was received, who declared it, and what is refunded. Sent whatever happens to the refund.
 */
export function withdrawalReceiptEmail(receipt: WithdrawalReceipt, language: Locale): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const at = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const title = receipt.contract === "plan" ? t("withdrawals.email.plan", { plan: receipt.subject }) : t("withdrawals.email.coachingSession", { coach: receipt.subject });
  const details = [
    t("withdrawals.email.concludedAt", { date: day.format(receipt.concludedAt) }),
    ...(receipt.paid ? [t("withdrawals.email.paid", { amount: money(receipt.paid.amount, receipt.paid.currency, i18n.language) })] : []),
  ];
  return renderEmail({
    language,
    subject: t("withdrawals.email.subject"),
    title: t("withdrawals.email.title"),
    body: [
      t("withdrawals.email.intro", { at: at.format(receipt.withdrawnAt) }),
      { card: { title, details } },
      t("withdrawals.email.declaredBy", { name: receipt.name }),
      receipt.contract === "plan" ? t("withdrawals.email.planEnded") : t("withdrawals.email.sessionCancelled", { coach: receipt.subject }),
      receipt.refunded
        ? t("withdrawals.email.refunded", { amount: money(receipt.refunded.amount, receipt.refunded.currency, i18n.language) })
        : t("withdrawals.email.nothingToRefund"),
      ...(receipt.kept ? [t("withdrawals.email.kept", { amount: money(receipt.kept.amount, receipt.kept.currency, i18n.language) })] : []),
      t("withdrawals.email.keep"),
    ],
    footer: { reason: t("withdrawals.email.reason") },
  });
}

/** What a Human Coach is told of a Coaching Session the Candidate withdrew from. */
export interface WithdrawnSessionNotice {
  /** "Marie D."; empty when the Candidate gave no name. */
  candidateName: string;
  paidAt: Date;
  scheduledAt: Date | null;
  /** Whether it had already taken place (bought without the Immediate Performance Request, #512). */
  held?: boolean;
}

/** Tells the Human Coach a Coaching Session is cancelled by a Withdrawal, in French (Human Coaches have no Interface Language yet). */
export function withdrawnSessionEmail(notice: WithdrawnSessionNotice, language: Locale = "fr"): RenderedEmail {
  const i18n = createI18n(language);
  const { t } = i18n;
  const at = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  const candidate = notice.candidateName || t("withdrawals.coachEmail.someone");
  return renderEmail({
    language,
    subject: t("withdrawals.coachEmail.subject", { candidate }),
    title: t("withdrawals.coachEmail.title"),
    body: [
      t("withdrawals.coachEmail.intro", { candidate, paidAt: day.format(notice.paidAt) }),
      notice.scheduledAt
        ? t(notice.held ? "withdrawals.coachEmail.held" : "withdrawals.coachEmail.scheduled", { at: at.format(notice.scheduledAt) })
        : t("withdrawals.coachEmail.unscheduled"),
      t("withdrawals.coachEmail.refunded"),
    ],
    footer: { reason: t("withdrawals.coachEmail.reason") },
  });
}
