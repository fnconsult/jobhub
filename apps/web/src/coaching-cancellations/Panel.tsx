import {getCoachingBooking} from "@/coaching-booking/server";
import {CancellationWindow} from "./Window";
import {CancelAgendaItemButton} from "@/components/CancelAgendaItemButton";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Status, type StatusTone } from "@/design/Pill";
import { getCoachingCancellations } from "./server";
import { getCoachingRefunds } from "@/coaching-refunds/server";
import { getServerT } from "@/i18n/server";
import { coachingTime } from "@jobhub/shared/coaching-time";
import { CancellationChoices } from "./Actions";
/** One of a list of things: an article (Card). */
const ARTICLE = "article";
/** A refund's outcome, in its tone: done, stuck with the support, or under way. */
const SUCCEEDED = "succeeded",
  PROBLEM = "problem",
  PENDING = "pending";
const REFUND_TONE = { succeeded: "success", problem: "danger", pending: "neutral" } as const satisfies Record<string, StatusTone>;
export async function CancellationPanel({ candidateId, locale, timeZone }: { candidateId: string; locale: "fr" | "en"; timeZone: string }) {
  const service = getCoachingCancellations(),
    cases = await service.forCandidate(candidateId),
    t = await getServerT(locale);
  if (!cases.length) return null;
  const bookingPaths=await getCoachingBooking().paths(candidateId);
  return (
    <section className="stack coaching-cancellations" aria-label={t("coachingCancellation.title")}>
      <h3>{t("coachingCancellation.title")}</h3>
      {await Promise.all(
        cases.map(async (c) => {
          const refund = c.refundId ? await getCoachingRefunds().one(c.refundId) : null;
          const outcome: keyof typeof REFUND_TONE = refund?.state === "succeeded" ? SUCCEEDED : refund?.state === "failed" || refund?.state === "needs_review" ? PROBLEM : PENDING;
          return (
            <Card as={ARTICLE} key={c.id} title={c.coachName} headingLevel={3} flat>
              <div className="stack">
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
                    <Status tone={REFUND_TONE[outcome]}>
                      {t(
                        outcome === SUCCEEDED
                          ? "coachingCancellation.refunded"
                          : outcome === PROBLEM
                            ? "coachingCancellation.refundProblem"
                            : "coachingCancellation.refundPending",
                      )}
                    </Status>
                  </p>
                )}
                {c.choice === "peer" && c.peerCoachId && refund?.state === "succeeded" ? (
                  <Link className={buttonClass({ variant: "primary" })} href={`/coachs/commande?coach=${c.peerCoachId}&remedy=${c.id}`}>
                    {t("coachingCancellation.newOrder")}
                  </Link>
                ) : null}
              </div>
            </Card>
          );
        }),
      )}
    </section>
  );
}
