import type { Metadata } from "next";
import { calendarPeriod, frenchDay, readAgendaAddress } from "@/agenda/calendar";
import { getAgenda } from "@/agenda/server";
import { loadAiActivity } from "@/ai-activity/server";
import { isArchivedApplication } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AgendaViewMemory } from "@/components/AgendaControls";
import { AddInterviewDialog, type InterviewableApplication } from "@/components/AddInterviewDialog";
import { AgendaMenuPage } from "@/components/AgendaMenuPage";
import { AgendaList, AgendaMonth, AgendaWeek, Legend, ToSchedule, ViewSwitch, formatsFor, type Withdrawable } from "@/components/AgendaViews";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { conversationFirst } from "@/conversation-first";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getWithdrawals } from "@/withdrawals/server";

/** What the AI Coach has In view here: the Agenda (its next 30 days, whichever period is shown). */
const AGENDA_IN_VIEW = { kind: "agenda", id: "agenda" } as const;
/** The address's value for the past Agenda Items (see routes.agenda). */
const PAST = "passes";

type SearchParams = { vue?: string | string[]; date?: string | string[]; periode?: string | string[]; ajouter?: string | string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("agenda.title")} · ${t("app.name")}` };
}

/**
 * The Agenda (« Entretiens et rendez-vous »): the Candidate's Agenda Items as a
 * list (the default), a week or a month, each view and period with its own
 * address (ADR-0028), the last view picked remembered in the browser.
 *  - The list: upcoming ones grouped by day in French time, oldest first;
 *    « Voir les rendez-vous passés » shows the past ones instead, newest first.
 *  - The week: Monday to Sunday, one column per day (stacked on phones), each
 *    listing its items with their time.
 *  - The month: a grid of days with a marker per item; choosing a day lists its
 *    items below the grid.
 * Past items are dimmed. An Interview leads to its Application's Interviews
 * Section, a Coaching Session to its Human Coach on the Human Coaches page.
 * Unscheduled Coaching Sessions sit at the top, « À planifier », with each Human
 * Coach's booking link and the cancellation of one dated before, and in no view.
 * In every view, a Cancelled Interview stays, struck through, with its date of
 * cancellation; a Rescheduled item says when it was first planned, with an
 * « Historique » of every change; a dated Coaching Session can be cancelled.
 * The AI Coach has the Agenda In view: its Agenda Items of the next 30 days.
 * Under « Conversation au centre » (#606, ADR-0070), the menu's conversation is the page instead, the list a card in its
 * thread, the week, the month and the form adding an Interview in the Work Pane (see AgendaMenuPage).
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const params = await searchParams;
  if (conversationFirst(getPlatformSettingsResolver().current())) {
    const [t, aiActivity] = await Promise.all([getServerT(), loadAiActivity.agenda(candidate.id)]);
    return (
      <CandidateLayout candidateId={candidate.id} title={t("agenda.title")} aiActivity={aiActivity}>
        <AgendaMenuPage candidateId={candidate.id} params={params} />
      </CandidateLayout>
    );
  }
  const now = new Date();
  const address = readAgendaAddress(params, now);
  const past = address.view === "liste" && params.periode === PAST;
  const agenda = getAgenda();
  const [t, locale, unscheduled, applications, aiActivity, contracts] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    agenda.unscheduled(candidate.id),
    getApplications().list(candidate.id),
    loadAiActivity.agenda(candidate.id),
    getWithdrawals().contracts(candidate.id),
  ]);
  // The Coaching Sessions « Renoncer au contrat ici » is offered on (#511): paid less than 14 days ago, not held yet.
  const withdrawable: Withdrawable = new Set(contracts.flatMap((contract) => (contract.kind === "coachingSession" ? [contract.sessionId] : [])));
  // The Application picker offers the ongoing Applications only: not the Archived ones.
  const ongoing: InterviewableApplication[] = applications
    .filter((application) => !isArchivedApplication(application))
    .map(({ id, status, jobOffer }) => ({ id, status, jobTitle: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}) }));
  const formats = formatsFor(locale, now);
  const today = frenchDay(now);

  let content;
  if (address.view === "liste") {
    const days = await agenda.days(candidate.id, { period: past ? "past" : "upcoming", now });
    content = <AgendaList days={days} past={past} withdrawable={withdrawable} formats={formats} t={t} />;
  } else {
    const period = calendarPeriod(address.view, address.date);
    const byDay = new Map((await agenda.daysBetween(candidate.id, period)).map((day) => [day.day, day.items]));
    content =
      address.view === "semaine" ? (
        <AgendaWeek period={period} byDay={byDay} today={today} withdrawable={withdrawable} formats={formats} t={t} />
      ) : (
        <AgendaMonth period={period} byDay={byDay} selected={address.date} today={today} withdrawable={withdrawable} formats={formats} t={t} />
      );
  }

  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")} wide={address.view === "semaine"} aiActivity={aiActivity}>
      {/* An address naming no view (the Sidebar's link) brings back the one last picked. */}
      <AgendaViewMemory view={address.view} restore={!address.chosen && params.periode === undefined} />
      <div className="agenda-page">
        <div className="agenda-toolbar">
          <ViewSwitch view={address.view} date={address.date} t={t} />
          <div className="agenda-actions">
            <AddInterviewDialog applications={ongoing} />
          </div>
        </div>
        <CoachInView {...AGENDA_IN_VIEW} name={t("agenda.title")} />
        {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} withdrawable={withdrawable} formats={formats} t={t} /> : null}
        {content}
        <Legend t={t} />
      </div>
    </CandidateLayout>
  );
}

