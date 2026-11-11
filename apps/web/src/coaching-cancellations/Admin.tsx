import { cancellationSupportRows, retryCancellationRefund } from "./support";
import { redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { requireBackOffice, getBackOffice } from "@/admin/server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getServerT } from "@/i18n/server";
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
        <article className="coach-space-card" key={row.id}>
          <p>
            {row.createdAt.toISOString()} · {row.source} · {row.choice}
          </p>
          <p>{row.reason}</p>
          <p>
            {row.state} {row.failure}
          </p>
          {canWrite && row.state === "failed" && row.refundId ? (
            <form action={retry}>
              <input type="hidden" name="refund" value={row.refundId} />
              <button className="button">{t("admin.withdrawals.retry")}</button>
            </form>
          ) : null}
        </article>
      ))}
    </section>
  );
}
