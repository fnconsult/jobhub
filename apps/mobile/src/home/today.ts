import type { AgendaResponse, ApplicationsResponse, CoachConversationsResponse } from "@jobhub/shared/reads";

/**
 * One line of « Votre point du jour », the home page's card (#979): only what calls for the Candidate's action, in this
 * order. A line with nothing to show is left out; with no line at all, the home page shows no card.
 */
export type TodayLine =
  | { kind: "offersToHandle"; count: number }
  | { kind: "interview"; scheduledAt: string; applicationId: string; jobTitle: string; employer: string | null }
  | { kind: "coachingSession"; scheduledAt: string; coachName: string; id: string }
  | { kind: "toSchedule"; count: number }
  | { kind: "followUps"; count: number; titles: string[]; applicationId: string | null }
  | { kind: "resume"; conversationId: string; title: string; lastMessageAt: string };

/** What the card reads, each `undefined` while it loads or when it could not be read: its line is then left out. */
export type TodayReads = {
  offersToHandle?: number;
  agenda?: AgendaResponse;
  applications?: ApplicationsResponse;
  conversations?: CoachConversationsResponse;
};

/** How many Applications to follow up the line names, the most recent first. */
const NAMED_FOLLOW_UPS = 2;

/**
 * The card's lines from what was read, at `now`: the Offer box's offers à traiter; the next Agenda Item from now on, none
 * cancelled (or, without one, the Unscheduled Coaching Sessions); the Applications whose Follow-up is ready; the Free
 * conversation last active, to resume.
 */
export function todayLines(reads: TodayReads, now: Date): TodayLine[] {
  const lines: TodayLine[] = [];
  if (reads.offersToHandle) lines.push({ kind: "offersToHandle", count: reads.offersToHandle });

  if (reads.agenda) {
    const next = reads.agenda.days
      .flatMap((day) => day.items)
      .filter((item) => new Date(item.scheduledAt).getTime() >= now.getTime() && !(item.kind === "interview" && item.cancelledAt))
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
    if (next?.kind === "interview")
      lines.push({ kind: "interview", scheduledAt: next.scheduledAt, applicationId: next.applicationId, jobTitle: next.jobTitle, employer: next.employer });
    else if (next?.kind === "coachingSession") lines.push({ kind: "coachingSession", scheduledAt: next.scheduledAt, coachName: next.coach.name, id: next.id });
    else if (reads.agenda.toSchedule.length) lines.push({ kind: "toSchedule", count: reads.agenda.toSchedule.length });
  }

  const followUps = reads.applications?.applications.filter((row) => row.toHandle === "follow_up" && !row.archived) ?? [];
  if (followUps.length)
    lines.push({
      kind: "followUps",
      count: followUps.length,
      titles: followUps.slice(0, NAMED_FOLLOW_UPS).map((row) => [row.title, row.employer].filter(Boolean).join(" · ")),
      // One alone opens its own page; several, Mes candidatures.
      applicationId: followUps.length === 1 ? followUps[0]!.id : null,
    });

  const last = reads.conversations?.conversations[0];
  if (last) lines.push({ kind: "resume", conversationId: last.id, title: last.title, lastMessageAt: last.lastMessageAt });
  return lines;
}
