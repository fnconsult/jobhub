import type { Queryable } from "../database/pool";
import type { Cancellation } from "./index";
import { renderEmail } from "../emails";
import { createI18n } from "@jobhub/shared/i18n";
import type { PushNotification } from "../push-notifications";
export async function cancellationNotice(
  database: Queryable,
  cancellation: Cancellation,
  kind: string,
  baseURL: string,
  send: (email: string, message: ReturnType<typeof renderEmail>) => Promise<unknown>,
  push: { notify: (id: string, event: PushNotification, options: { once: string }) => Promise<unknown> },
) {
  const recipients = (
    await database.query<{ id: string; email: string; locale: "fr" | "en"; coach: boolean }>(
      `SELECT c.id,c.email,coalesce(c."interfaceLanguage",'fr') AS locale,false AS coach FROM candidate c WHERE c.id=$1 UNION ALL SELECT c.id,c.email,coalesce(c."interfaceLanguage",'fr'),true FROM candidate c JOIN human_coach h ON lower(c.email)=h.email AND c."emailVerified" AND h.retired_at IS NULL WHERE h.id=$2 ORDER BY coach,id`,
      [cancellation.candidateId, cancellation.coachId],
    )
  ).rows;
  for (const person of recipients) {
    const { t } = createI18n(person.locale),
      path = person.coach ? `/espace-coach/seances/${cancellation.sessionId}` : "/coachs";
    const key = kind.startsWith("refund_succeeded:")
      ? "refunded"
      : kind.startsWith("refund_failed:") || kind.startsWith("refund_needs_review:")
        ? "refundProblem"
        : kind === "choice_requested"
          ? "choices"
          : kind === "confirmation_requested"
            ? "confirmation"
            : kind === "same_chosen"
              ? "sameConfirmed"
              : kind === "coach_cancelled"
                ? "candidateCancelled"
                : "refundPending";
    const subject = t("coachingCancellation.title");
    async function once(channel: "email" | "push", deliver: () => Promise<unknown>) {
      const args = [cancellation.id, kind, person.id, channel];
      if (
        (await database.query("SELECT 1 FROM coaching_cancellation_delivery WHERE cancellation_id=$1 AND kind=$2 AND recipient_id=$3 AND channel=$4", args))
          .rowCount
      )
        return;
      await deliver();
      await database.query(
        "INSERT INTO coaching_cancellation_delivery(cancellation_id,kind,recipient_id,channel,completed_at) VALUES($1,$2,$3,$4,clock_timestamp()) ON CONFLICT DO NOTHING",
        args,
      );
    }
    await once("email", () =>
      send(
        person.email,
        renderEmail({
          language: person.locale,
          subject,
          title: subject,
          body: [
            t(`coachingCancellation.${key}`),
            ...(cancellation.reason ? [t("coachingCancellation.reason") + ": " + cancellation.reason] : []),
            { action: { label: t("coachingCancellation.open"), url: new URL(path, baseURL).href } },
          ],
          footer: { reason: t("coachingCancellation.emailReason") },
        }),
      ),
    );
    await once("push", () =>
      push.notify(
        person.id,
        { event: person.coach ? "coaching_session_changed_by_candidate" : "coaching_cancellation" },
        { once: `cancellation:${cancellation.id}:${kind}:${person.coach ? "coach" : "candidate"}` },
      ),
    );
  }
}
