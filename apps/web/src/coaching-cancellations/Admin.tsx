import { cancellationSupportRows, retryCancellationRefund } from "./support";
import { redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { requireBackOffice, getBackOffice } from "@/admin/server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Status, type StatusTone } from "@/design/Pill";
import { getServerT } from "@/i18n/server";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
/** A contractual refund's state, in its tone (none: a Case without a refund). */
const REFUND_TONE: Record<string, StatusTone> = { succeeded: "success", failed: "danger", needs_review: "warn", pending: "neutral" };
async function retry(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("withdrawals", "write"),
    id = String(form.get("refund") ?? "");
  await retryCancellationRefund(getCoachingRefunds(), id, (before) =>
    getBackOffice().record(
      administrator,
      async () => true,
      () => ({
        section: "withdrawals",
        target: id,
        action: "updated",
        before: { state: before.state, attempt: before.attempt },
        after: { contractualRefundRetryRequested: true },
      }),
    ),
  );
  redirect("/admin/retractations");
}
export async function CancellationAdmin({ canWrite }: { canWrite: boolean }) {
  const t = await getServerT();
  const rows = await cancellationSupportRows(sharedPool());
  if (!rows.length) return null;
  return (
    <section className="stack">
      <h2>{t("coachingCancellation.title")}</h2>
      {rows.map((row) => (
        <Card as={ARTICLE} key={row.id}>
          <div className="stack">
            <p>
              {row.createdAt.toISOString()} · {row.source} · {row.choice}
            </p>
            <p>{row.reason}</p>
            {row.state ? (
              <p>
                <Status tone={REFUND_TONE[row.state] ?? "neutral"}>{row.state}</Status> {row.failure}
              </p>
            ) : null}
            {canWrite && row.state === "failed" && row.refundId ? (
              <form action={retry}>
                <input type="hidden" name="refund" value={row.refundId} />
                <button className={buttonClass({ size: "sm" })} type="submit">
                  {t("admin.withdrawals.retry")}
                </button>
              </form>
            ) : null}
          </div>
        </Card>
      ))}
    </section>
  );
}
