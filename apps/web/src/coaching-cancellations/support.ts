import type { Queryable } from "../database/pool";
import type { coachingRefunds, CoachingRefund } from "../coaching-refunds";
/** Support must see detached money debts independently of the erased personal Case. No contact data is reconstructed. */
export async function cancellationSupportRows(database: Queryable) {
  return (
    await database.query<{
      id: string;
      source: string;
      reason: string | null;
      choice: string;
      createdAt: Date;
      refundId: string | null;
      state: string | null;
      failure: string | null;
    }>(`
 SELECT coalesce(c.id,r.id) AS id,coalesce(c.source,'retained_refund') AS source,c.reason,coalesce(c.choice,'refund') AS choice,coalesce(c.created_at,r.created_at) AS "createdAt",r.id AS "refundId",r.state,r.failure_reason AS failure FROM coaching_service_refund r LEFT JOIN coaching_cancellation c ON c.refund_id=r.id
 UNION ALL SELECT c.id,c.source,c.reason,c.choice,c.created_at,NULL,NULL,NULL FROM coaching_cancellation c WHERE c.refund_id IS NULL
 ORDER BY "createdAt" DESC,id`)
  ).rows;
}
/** Audit the privileged request before attempting remote money movement; a failed audit performs no retry. */
export async function retryCancellationRefund(
  refunds: Pick<ReturnType<typeof coachingRefunds>, "one" | "retry">,
  id: string,
  record: (before: CoachingRefund) => Promise<unknown>,
) {
  const before = await refunds.one(id);
  if (!before || before.state !== "failed") return false;
  await record(before);
  return refunds.retry(id);
}
