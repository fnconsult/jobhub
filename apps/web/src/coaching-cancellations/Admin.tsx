import { redirect } from "next/navigation";
import { sharedPool } from "@/database/pool";
import { requireBackOffice, getBackOffice } from "@/admin/server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getServerT } from "@/i18n/server";
async function retry(form: FormData) {
  "use server";
  const { administrator } = await requireBackOffice("withdrawals", "write"),
    id = String(form.get("refund") ?? "");
  const before = await getCoachingRefunds().one(id);
  if (!before) redirect("/admin/retractations");
  const accepted = await getCoachingRefunds().retry(id);
  if (accepted)
    await getBackOffice().record(
      administrator,
      async () => true,
      () => ({
        section: "withdrawals",
        target: id,
        action: "updated",
        before: { state: before.state, attempt: before.attempt },
        after: { contractualRefundRetry: true },
      }),
    );
  redirect("/admin/retractations");
}
export async function CancellationAdmin({ canWrite }: { canWrite: boolean }) {
  const t = await getServerT();
  const rows = (
    await sharedPool().query<{
      id: string;
      source: string;
      reason: string | null;
      choice: string;
      createdAt: Date;
      refundId: string | null;
      state: string | null;
      failure: string | null;
    }>(
      `SELECT c.id,c.source,c.reason,c.choice,c.created_at AS "createdAt",c.refund_id AS "refundId",r.state,r.failure_reason AS failure FROM coaching_cancellation c LEFT JOIN coaching_service_refund r ON r.id=c.refund_id ORDER BY c.created_at DESC,c.id`,
    )
  ).rows;
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
