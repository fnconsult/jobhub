import Link from "next/link";
import { calendarPeriod, frenchDay, type AgendaView, type CalendarView } from "@/agenda/calendar";
import { readAgendaMenuAddress, type AgendaPane } from "@/agenda/menu";
import { getAgenda } from "@/agenda/server";
import { isArchivedApplication } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { AddInterviewForm, type InterviewableApplication } from "@/components/AddInterviewDialog";
import { AgendaList, AgendaMonth, AgendaWeek, Legend, ToSchedule, ViewSwitch, formatsFor, type Formats, type Withdrawable } from "@/components/AgendaViews";
import { CoachConversationPage } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import { getWithdrawals } from "@/withdrawals/server";
import "./MenuCards.css";
import "./QuickActions.css";

type T = Awaited<ReturnType<typeof getServerT>>;
type AgendaParams = Parameters<typeof readAgendaMenuAddress>[0];

/** The Agenda's Subject: the menu's one conversation per Candidate (ADR-0070); its replies' Focus is the Agenda. */
const SUBJECT = { kind: "menu", id: "agenda" } as const;
/** The week and the month in the Work Pane: views of the Agenda, like an object's Section. */
const VIEW: AddressedKind = "section";
/** The view the card shows: the list. */
const LIST: AgendaView = "liste";
/** The form adding an Interview, in the Work Pane. */
const FORM: AddressedKind = "form";

/**
 * The Agenda under « Conversation au centre » (#606, ADR-0070): the menu's conversation, one per Candidate, as the page.
 * Its Introduction says what the page is for; its card holds the list (upcoming Agenda Items by day, or the past ones,
 * and « À planifier »), with « Liste », « Semaine », « Mois » and « Ajouter un entretien ». The week and the month open in
 * the Work Pane beside it, at their own addresses, as does the form adding an Interview (`params`, see
 * readAgendaMenuAddress); closing it goes back to the list's address.
 */
export async function AgendaMenuPage({ candidateId, params }: { candidateId: string; params: AgendaParams }) {
  const now = new Date();
  const { past, pane } = readAgendaMenuAddress(params, now);
  const agenda = getAgenda();
  const [t, locale, unscheduled, days, applications, contracts, subject] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    agenda.unscheduled(candidateId),
    agenda.days(candidateId, { period: past ? "past" : "upcoming", now }),
    getApplications().list(candidateId),
    getWithdrawals().contracts(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
  ]);
  // The Coaching Sessions « Renoncer au contrat ici » is offered on (#511): paid less than 14 days ago, not held yet.
  const withdrawable: Withdrawable = new Set(contracts.flatMap((contract) => (contract.kind === "coachingSession" ? [contract.sessionId] : [])));
  const formats = formatsFor(locale, now);
  const conversationId = subject.ok ? (subject.conversation?.id ?? null) : null;
  const back = routes.agenda(past);
  const addInterview = (
    <Link className={buttonClass({ size: "sm" })} href={routes.agendaAddInterview} scroll={false}>
      <Icons.add />
      {t("agendaMenu.addInterview")}
    </Link>
  );
  return (
    <>
      <CoachConversationPage
        key={conversationId ?? "new"}
        conversationId={conversationId}
        subject={SUBJECT}
        introduction={<p>{t("agendaMenu.introduction")}</p>}
        card={
          <Card>
            <div className="agenda-toolbar">
              <ViewSwitch view={LIST} date={frenchDay(now)} t={t} />
              <div className="agenda-actions">{addInterview}</div>
            </div>
            {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} withdrawable={withdrawable} formats={formats} t={t} /> : null}
            <AgendaList days={days} past={past} withdrawable={withdrawable} formats={formats} t={t} />
            <Legend t={t} />
          </Card>
        }
        suggestions={
          <nav className="quick-actions" aria-label={t("quickActions.label")}>
            {addInterview}
          </nav>
        }
      />
      {pane?.kind === "calendar" ? <CalendarPane pane={pane} back={back} candidateId={candidateId} now={now} withdrawable={withdrawable} formats={formats} t={t} /> : null}
      {pane?.kind === "addInterview" ? (
        <InWorkPane kind={FORM} title={t("agenda.addDialog.title")} href={pane.href} back={back}>
          <AddInterviewForm applications={interviewable(applications)} />
        </InWorkPane>
      ) : null}
    </>
  );
}

/** The ongoing Applications an Interview can be added to: not the Archived ones. */
function interviewable(applications: Awaited<ReturnType<ReturnType<typeof getApplications>["list"]>>): InterviewableApplication[] {
  return applications
    .filter((application) => !isArchivedApplication(application))
    .map(({ id, status, jobOffer }) => ({ id, status, jobTitle: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}) }));
}

/** The week or the month in the Work Pane, under its range or its month as the pane's title. */
async function CalendarPane({
  pane,
  back,
  candidateId,
  now,
  withdrawable,
  formats,
  t,
}: {
  pane: Extract<AgendaPane, { kind: "calendar" }>;
  back: string;
  candidateId: string;
  now: Date;
  withdrawable: Withdrawable;
  formats: Formats;
  t: T;
}) {
  const view: CalendarView = pane.view;
  const period = calendarPeriod(view, pane.date);
  const byDay = new Map((await getAgenda().daysBetween(candidateId, period)).map((day) => [day.day, day.items]));
  const today = frenchDay(now);
  const title = view === "semaine" ? t("agenda.weekTitle", { range: formats.range(period.first, period.last) }) : formats.month(period.first);
  return (
    <InWorkPane kind={VIEW} title={title} href={pane.href} back={back}>
      {view === "semaine" ? (
        <AgendaWeek period={period} byDay={byDay} today={today} withdrawable={withdrawable} formats={formats} t={t} />
      ) : (
        <AgendaMonth period={period} byDay={byDay} selected={pane.date} today={today} withdrawable={withdrawable} formats={formats} t={t} />
      )}
    </InWorkPane>
  );
}
