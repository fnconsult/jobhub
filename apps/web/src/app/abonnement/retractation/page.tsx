import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AccountSections } from "@/components/AccountSections";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Radio, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Properties, Property } from "@/design/Properties";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import type { ContractToWithdraw, Withdrawal } from "@/withdrawals";
import { money } from "@/withdrawals/email";
import { getWithdrawals } from "@/withdrawals/server";
import "../abonnement.css";

type T = Awaited<ReturnType<typeof getServerT>>;

/** What the form can be sent back with (`erreur`): a field and why, or why the contract could not be withdrawn from. */
const ERRORS = ["name_required", "name_too_long", "receiptEmail_required", "receiptEmail_invalid", "not_withdrawable", "stripe_unavailable"] as const;
type FormError = (typeof ERRORS)[number];
const isFormError = (value: unknown): value is FormError => ERRORS.includes(value as FormError);

const ZONE = { timeZone: "Europe/Paris" } as const;

/** Where the acknowledgement goes: the account's address, or the one typed. */
const RECEIPT_ACCOUNT = "account";
const RECEIPT_OTHER = "other";
/** The form's fields an error can name. */
const NAME = "name";
const RECEIPT_EMAIL = "receiptEmail";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("withdrawals.page.title")} · ${t("app.name")}` };
}

/**
 * « Renoncer au contrat ici » (#511, C. conso. L221-21 al. 3): the Withdrawal form of one contract (`contrat`: the
 * Plan's subscription or a Coaching Session), a page of Jobbbox's own: the contract named with its date and amount,
 * the Candidate's name, where the acknowledgement goes, and « Confirmer la rétractation ». A Plan bought with the
 * Immediate Performance Request (#512) says what is refunded of it: the amount paid less the days elapsed. With `faite`, the Withdrawal
 * just recorded: when, what is refunded, where the acknowledgement went.
 */
export default async function WithdrawalPage({ searchParams }: { searchParams: Promise<{ contrat?: string | string[]; faite?: string | string[]; erreur?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { contrat, faite, erreur } = await searchParams;
  const withdrawals = getWithdrawals();
  const done = typeof faite === "string" ? await withdrawals.withdrawal(candidate.id, faite) : null;
  const contract = !done && typeof contrat === "string" ? await withdrawals.contract(candidate.id, contrat) : null;

  return (
    <AccountSections candidateId={candidate.id}>
      <div className="subscription withdrawal">
        <h2>{t("withdrawals.page.title")}</h2>
        {done ? (
          <Done withdrawal={done} locale={locale} t={t} />
        ) : contract ? (
          <WithdrawalForm contract={contract} name={candidate.name ?? ""} email={candidate.email} error={isFormError(erreur) ? erreur : null} locale={locale} t={t} />
        ) : (
          <Note tone="warn" role="status">
            <p>{t("withdrawals.page.nothing")}</p>
            <Link href={routes.subscription}>{t("withdrawals.page.back")}</Link>
          </Note>
        )}
      </div>
    </AccountSections>
  );
}

/** The contract's title: « Offre Standard », « Séance de coaching avec Sophie Martin ». */
function contractTitle(contract: { kind: "plan" | "coachingSession"; subject: { fr: string; en: string } }, locale: "fr" | "en", t: T): string {
  return contract.kind === "plan" ? t("withdrawals.email.plan", { plan: contract.subject[locale] }) : t("withdrawals.email.coachingSession", { coach: contract.subject[locale] });
}

function WithdrawalForm({ contract, name, email, error, locale, t }: { contract: ContractToWithdraw; name: string; email: string; error: FormError | null; locale: "fr" | "en"; t: T }) {
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...ZONE });
  // The deadline is the first instant past the period: its last day is the day before.
  const lastDay = day.format(new Date(contract.deadline.getTime() - 1));
  // A Plan bought with the Immediate Performance Request: the service already provided is paid for (L221-25).
  const prorata = contract.kind === "plan" && contract.immediateExecutionRequested;
  const fieldError = (field: typeof NAME | typeof RECEIPT_EMAIL) => (error?.startsWith(`${field}_`) ? t(`withdrawals.page.errors.${error}`) : undefined);
  return (
    <>
      {error === "not_withdrawable" || error === "stripe_unavailable" ? (
        <Note tone="danger" role="alert">
          {t(`withdrawals.page.errors.${error}`)}
        </Note>
      ) : null}
      <p>{t(prorata ? "withdrawals.page.introProrata" : "withdrawals.page.intro", { date: lastDay })}</p>
      <Card title={t("withdrawals.page.contractTitle")} headingLevel={3}>
        <Properties>
          <Property term={t("withdrawals.page.contract")}>{contractTitle(contract, locale, t)}</Property>
          <Property term={t(contract.kind === "plan" ? "withdrawals.page.subscribedOn" : "withdrawals.page.paidOn")}>{day.format(contract.concludedAt)}</Property>
          <Property term={t("withdrawals.page.amount")}>{contract.paid ? money(contract.paid.amount, contract.paid.currency, locale) : t("withdrawals.page.amountUnknown")}</Property>
          {prorata && contract.refund ? <Property term={t("withdrawals.page.refundNow")}>{money(contract.refund.amount, contract.refund.currency, locale)}</Property> : null}
        </Properties>
      </Card>
      <form className="withdrawal-form" method="post" action="/api/withdrawals">
        <input type="hidden" name="contract" value={contract.ref} />
        <Field label={t("withdrawals.page.name")} error={fieldError(NAME)}>
          <TextInput name="name" defaultValue={name} required maxLength={200} autoComplete="name" />
        </Field>
        <fieldset className="withdrawal-receipt">
          <legend>{t("withdrawals.page.receipt")}</legend>
          <Radio name="receipt" value={RECEIPT_ACCOUNT} defaultChecked label={t("withdrawals.page.receiptAccount", { email })} />
          <Radio name="receipt" value={RECEIPT_OTHER} label={t("withdrawals.page.receiptOther")} />
          <Field label={t("withdrawals.page.receiptEmail")} hint={t("withdrawals.page.receiptEmailHint")} error={fieldError(RECEIPT_EMAIL)}>
            <TextInput name="receiptEmail" type="email" maxLength={320} autoComplete="email" />
          </Field>
        </fieldset>
        <p>{t(prorata ? "withdrawals.page.whatHappensPlanProrata" : contract.kind === "plan" ? "withdrawals.page.whatHappensPlan" : "withdrawals.page.whatHappensSession")}</p>
        <div className="withdrawal-actions">
          <button className={buttonClass({ variant: "primary" })} type="submit">
            {t("withdrawals.page.confirm")}
          </button>
          <Link className={buttonClass({ variant: "quiet" })} href={contract.kind === "plan" ? routes.subscription : routes.agenda()}>
            {t("withdrawals.page.cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}

function Done({ withdrawal, locale, t }: { withdrawal: Withdrawal; locale: "fr" | "en"; t: T }) {
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", ...ZONE });
  const refunded = withdrawal.refunds.reduce((sum, refund) => sum + refund.amount, 0);
  return (
    <>
      <Note tone="success" role="status">
        <p>{t("withdrawals.page.done", { contract: contractTitle({ kind: withdrawal.contract, subject: withdrawal.subject }, locale, t), at: at.format(withdrawal.withdrawnAt) })}</p>
        <p>
          {refunded > 0
            ? t("withdrawals.page.refunded", { amount: money(refunded, withdrawal.refunds[0]!.currency, locale) })
            : t("withdrawals.email.nothingToRefund")}
        </p>
        <p>{withdrawal.receiptSentAt ? t("withdrawals.page.receiptSent", { email: withdrawal.receiptEmail }) : t("withdrawals.page.receiptNotSent")}</p>
      </Note>
      <p>
        <Link href={withdrawal.contract === "plan" ? routes.subscription : routes.agenda()}>{t(withdrawal.contract === "plan" ? "withdrawals.page.back" : "withdrawals.page.backToAgenda")}</Link>
      </p>
    </>
  );
}
