import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { IntroPage } from "@/admin/page-intro";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { Status, type StatusTone } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import type { ListedWithdrawal, RefundState, WithdrawalRefund } from "@/withdrawals";
import { money } from "@/withdrawals/email";
import { getWithdrawals } from "@/withdrawals/server";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "withdrawals";

/** The list's order: newest first. */
const NEWEST_FIRST = "descending";

/** Where a refund stands: a failed one stands out. */
const STATE_TONE: Record<RefundState, StatusTone> = { pending: "neutral", succeeded: "success", failed: "danger" };

type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  await requireBackOffice("withdrawals");
  const t = await getServerT();
  return { title: `${t("admin.withdrawals.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** Tries a failed refund again, recorded in the Back Office Audit with where it stands after. */
async function retryRefund(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("withdrawals", "write");
  const refundId = String(form.get("refund") ?? "");
  const retried = await getWithdrawals().retryRefund(refundId);
  if (!retried.ok) redirect(`${routes.adminWithdrawals}?error=${retried.error}`);
  await getBackOffice().record(
    administrator,
    async () => retried,
    (result) => ({ section: "withdrawals", target: refundId, action: "updated", before: { refund: "failed" }, after: { refund: result.status } }),
  );
  redirect(`${routes.adminWithdrawals}?retried=${retried.status}`);
}

/**
 * Rétractations (#511): every Withdrawal, newest first, with its Candidate, its contract, when it was received and
 * acknowledged, and each refund with where it stands at Stripe. Support tries a failed refund again; others read.
 */
export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<{ retried?: string; error?: string }> }) {
  const { access, canWrite } = await requireBackOffice("withdrawals");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { retried, error } = await searchParams;
  const withdrawals = await getWithdrawals().list();
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const failed = withdrawals.flatMap((withdrawal) => withdrawal.refunds).filter((refund) => refund.status === "failed").length;

  return (
    <BackOfficeLayout access={access} title={t("admin.withdrawals.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.withdrawals.title")}>
          {canWrite ? null : <p>{t("admin.readOnly")}</p>}
        </PageIntro>
        {retried === "succeeded" || retried === "pending" || retried === "failed" ? (
          <Note tone={retried === "failed" ? "danger" : "success"} role="status">
            {t(`admin.withdrawals.retried.${retried}`)}
          </Note>
        ) : null}
        {error === "not_found" || error === "not_failed" ? (
          <Note tone="danger" role="alert">
            {t(`admin.withdrawals.errors.${error}`)}
          </Note>
        ) : null}
        {failed > 0 ? (
          <Note tone="warn" role="status">
            {t("admin.withdrawals.failedCount", { count: failed })}
          </Note>
        ) : null}
        {withdrawals.length === 0 ? (
          <p>{t("admin.withdrawals.none")}</p>
        ) : (
          <Table
            label={t("admin.withdrawals.caption")}
            columns={[
              { header: t("admin.withdrawals.withdrawnAt"), rowHeader: true, cell: (withdrawal: ListedWithdrawal) => at.format(withdrawal.withdrawnAt), sort: NEWEST_FIRST },
              { header: t("admin.withdrawals.candidate"), cell: (withdrawal) => withdrawal.candidateEmail },
              {
                header: t("admin.withdrawals.contract"),
                cell: (withdrawal) => (
                  <>
                    {withdrawal.contract === "plan" ? t("withdrawals.email.plan", { plan: withdrawal.subject[locale] }) : t("withdrawals.email.coachingSession", { coach: withdrawal.subject[locale] })}
                    <br />
                    <span className="section-meta">{t("admin.withdrawals.concludedAt", { date: at.format(withdrawal.concludedAt) })}</span>
                  </>
                ),
              },
              {
                header: t("admin.withdrawals.receipt"),
                cell: (withdrawal) => (withdrawal.receiptSentAt ? t("admin.withdrawals.receiptSent", { email: withdrawal.receiptEmail, at: at.format(withdrawal.receiptSentAt) }) : t("admin.withdrawals.receiptNotSent", { email: withdrawal.receiptEmail })),
              },
              {
                header: t("admin.withdrawals.refunds"),
                cell: (withdrawal) =>
                  withdrawal.refunds.length === 0 ? (
                    t("admin.withdrawals.nothingToRefund")
                  ) : (
                    <ul className="section-list">
                      {withdrawal.refunds.map((refund) => (
                        <li key={refund.id}>
                          <RefundLine refund={refund} canWrite={canWrite} locale={locale} t={t} />
                        </li>
                      ))}
                    </ul>
                  ),
              },
            ]}
            rows={withdrawals}
            rowKey={(withdrawal) => withdrawal.id}
          />
        )}
      </div>
    </BackOfficeLayout>
  );
}

/** One refund: its amount and where it stands, why it failed, and « Relancer le remboursement » when it did. */
function RefundLine({ refund, canWrite, locale, t }: { refund: WithdrawalRefund; canWrite: boolean; locale: "fr" | "en"; t: T }) {
  return (
    <>
      {money(refund.amount, refund.currency, locale)} <Status tone={STATE_TONE[refund.status]}>{t(`admin.withdrawals.states.${refund.status}`)}</Status>
      {refund.failureReason ? <span className="section-meta"> {t("admin.withdrawals.failureReason", { reason: refund.failureReason })}</span> : null}
      {refund.attempts > 1 ? <span className="section-meta"> {t("admin.withdrawals.attempts", { count: refund.attempts })}</span> : null}
      {canWrite && refund.status === "failed" ? (
        <form action={retryRefund}>
          <input type="hidden" name="refund" value={refund.id} />
          <button className={buttonClass({ size: "sm" })} type="submit">
            {t("admin.withdrawals.retry")}
          </button>
        </form>
      ) : null}
    </>
  );
}
