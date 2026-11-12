import Link from "next/link";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { cancellationPolicyOn } from "@/coaching-cancellations/server";
import { getCoachContacts } from "@/coach-space/contacts-server";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { calendarPeriod, frenchDay, type AgendaView, type CalendarView } from "@/agenda/calendar";
import { readAgendaMenuAddress, type AgendaPane } from "@/agenda/menu";
import { getAgenda } from "@/agenda/server";
import { isArchivedApplication } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { AddInterviewForm, type InterviewableApplication } from "@/components/AddInterviewDialog";
import { AgendaList, AgendaMonth, AgendaWeek, Legend, ToSchedule, ViewSwitch, formatsFor, type Formats, type Withdrawable } from "@/components/AgendaViews";
import { CoachConversationPage } from "@/components/CoachConversationPage";
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
/**
 * What goes with each message, as the page's object: the Agenda, its next 30 days (#254). The box's line says so
 * (« Vous consultez : vos entretiens et rendez-vous des 30 prochains jours »), as the replies' Focus is the Agenda.
 */
const IN_VIEW = { kind: "agenda", id: "agenda" } as const;
/** The week and the month in the Work Pane: views of the Agenda, like an object's Section. */
const VIEW: AddressedKind = "section";
/** The view the card shows: the list, « Liste » current while neither the week nor the month is open beside it. */
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
  // « Espace coach v2 » (ADR-0106): off, the Agenda is the one before the Human Coach epic (Paris time, no meetings, no policy).
  const v2 = coachSpaceV2On();
  const timeZone = v2 ? await candidateZone(candidateId) : undefined;
  const [t, locale, unscheduled, days, applications, contracts, subject] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    agenda.unscheduled(candidateId),
    agenda.days(candidateId, { period: past ? "past" : "upcoming", now, ...(v2 ? { timeZone } : {}) }),
    getApplications().list(candidateId),
    getWithdrawals().contracts(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
  ]);
  // The Coaching Sessions « Renoncer au contrat ici » is offered on (#511): paid less than 14 days ago, not held yet.
  const withdrawable: Withdrawable = new Set(contracts.flatMap((contract) => (contract.kind === "coachingSession" ? [contract.sessionId] : [])));
  const formats = formatsFor(locale, now, v2 ? { timeZone } : undefined);
  if (v2) {
    formats.cancellationPolicy = await cancellationPolicyOn();
    formats.meetings = await getCoachContacts().forCandidate(candidateId);
  }
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
        inView={{ ...IN_VIEW, name: t("agenda.title") }}
        introduction={<p>{t("agendaMenu.introduction")}</p>}
        card={
          <Card>
            {/* Drawn as the Agenda's page was: its targets at the 44px floor, its long buttons wrapping on a phone (#608). */}
            <div className="agenda-card">
              <div className="agenda-toolbar">
                {/* The view the address names is the one shown, the week or the month in the Work Pane beside the list. */}
                <ViewSwitch view={pane?.kind === "calendar" ? pane.view : LIST} date={pane?.kind === "calendar" ? pane.date : frenchDay(now)} t={t} />
                <div className="agenda-actions">{addInterview}</div>
              </div>
              {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} withdrawable={withdrawable} formats={formats} t={t} /> : null}
              <AgendaList days={days} past={past} withdrawable={withdrawable} formats={formats} t={t} />
              <Legend t={t} />
            </div>
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
  const days = formats.coachSpaceV2 ? { ...period, timeZone: await candidateZone(candidateId) } : period;
  const byDay = new Map((await getAgenda().daysBetween(candidateId, days)).map((day) => [day.day, day.items]));
  const today = frenchDay(now);
  const title = view === "semaine" ? t("agenda.weekTitle", { range: formats.range(period.first, period.last) }) : formats.month(period.first);
  return (
    <InWorkPane kind={VIEW} title={title} href={pane.href} back={back}>
      <div className="agenda-card">
        {view === "semaine" ? (
          <AgendaWeek period={period} byDay={byDay} today={today} withdrawable={withdrawable} formats={formats} t={t} />
        ) : (
          <AgendaMonth period={period} byDay={byDay} selected={pane.date} today={today} withdrawable={withdrawable} formats={formats} t={t} />
        )}
      </div>
    </InWorkPane>
  );
}

/** The Candidate's coaching time zone under « Espace coach v2 », or none (Paris). */
async function candidateZone(candidateId: string): Promise<string | undefined> {
  return (await getCoachingTimeZones().candidate(candidateId)) ?? undefined;
}
