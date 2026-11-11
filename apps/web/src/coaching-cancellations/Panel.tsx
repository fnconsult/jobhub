import {getCoachingBooking} from "@/coaching-booking/server";
import {CancellationWindow} from "./Window";
import {CancelAgendaItemButton} from "@/components/CancelAgendaItemButton";
import Link from "next/link";
import { getCoachingCancellations } from "./server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getServerT } from "@/i18n/server";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { CancellationChoices } from "./Actions";
export async function CancellationPanel({ candidateId, locale, timeZone }: { candidateId: string; locale: "fr" | "en"; timeZone: string }) {
  const service = getCoachingCancellations(),
    cases = await service.forCandidate(candidateId),
    t = await getServerT(locale);
  if (!cases.length) return null;
  const bookingPaths=await getCoachingBooking().paths(candidateId);
  return (
    <section className="stack" aria-label={t("coachingCancellation.title")}>
      <h3>{t("coachingCancellation.title")}</h3>
      {await Promise.all(
        cases.map(async (c) => {
          const refund = c.refundId ? await getCoachingRefunds().one(c.refundId) : null;
          return (
            <article key={c.id} className="coach-space-card stack">
              <h4>{c.coachName}</h4>
              <p>{c.reason || t("coachingCancellation.candidateCancelled")}</p>
              {c.originalAt ? (
                <p>
                  {t("coachingCancellation.original")}: {coachingTime(c.originalAt, locale, timeZone)}
                </p>
              ) : null}
              {c.choice === "awaiting" ? (
                c.choiceDueAt ? (
                  <>
                    <p>{t("coachingCancellation.choices")}</p>
                    <p>{t("coachingCancellation.deadline", { date: coachingTime(c.choiceDueAt, locale, timeZone) })}</p>
                    <CancellationChoices id={c.id} peers={await service.peerOptions(candidateId, c.id)} />
                  </>
                ) : (
                  <><p>{t("coachingCancellation.confirmation")}</p><CancellationWindow at={c.originalAt?.toISOString()??null}><CancelAgendaItemButton url={`/api/coaching/sessions/${c.sessionId}/cancel`} label={t("coachingCancellation.refund")} name={t("coachingCancellation.refund")} question={t("coachingCancellation.confirmationRefund")}/></CancellationWindow></>
                )
              ) : c.choice === "same" ? (
                <Link href={bookingPaths[c.sessionId]??`/coachs#seance-${c.sessionId}`}>{t("coachingCancellation.bookSame")}</Link>
              ) : (
                <p role="status">
                  {t(
                    refund?.state === "succeeded"
                      ? "coachingCancellation.refunded"
                      : refund?.state === "failed" || refund?.state === "needs_review"
                        ? "coachingCancellation.refundProblem"
                        : "coachingCancellation.refundPending",
                  )}
                </p>
              )}
              {c.choice === "peer" && c.peerCoachId && refund?.state === "succeeded" ? (
                <Link className="button" href={`/coachs/commande?coach=${c.peerCoachId}&remedy=${c.id}`}>
                  {t("coachingCancellation.newOrder")}
                </Link>
              ) : null}
            </article>
          );
        }),
      )}
    </section>
  );
}
