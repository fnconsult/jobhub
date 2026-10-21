import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgendaDay, AgendaItem, CoachingSessionAgendaItem, InterviewAgendaItem, UnscheduledCoachingSession } from "@/agenda";
import { getAgenda } from "@/agenda/server";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { isArchivedApplication } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { AddInterviewDialog, type InterviewableApplication } from "@/components/AddInterviewDialog";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachingSessionDialog } from "@/components/CoachingSessionDialog";
import { InterviewFacts, InterviewTimes } from "@/components/InterviewDetails";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes, type ApplicationSection } from "@/routes";

/** Where an Interview leads: its Application's Interviews Section. */
const INTERVIEWS: ApplicationSection = "entretiens";
/** The address's value for the past Agenda Items (see routes.agenda). */
const PAST = "passes";

type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("agenda.title")} · ${t("app.name")}` };
}

/**
 * The Agenda (« Entretiens et rendez-vous »): the Candidate's Agenda Items as a
 * list, upcoming ones by default, grouped by day in French time, oldest first.
 * « Voir les rendez-vous passés » shows the past ones instead, newest first and
 * dimmed. An Interview leads to its Application's Interviews Section, with its end time
 * (an hour after it starts when no duration), format and place or link; a Coaching
 * Session to its Human Coach on the Human Coaches page. Unscheduled Coaching
 * Sessions sit at the top, « À planifier », with each Human Coach's booking link.
 * « Ajouter un entretien » adds an Interview to one of the ongoing Applications (#247).
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const past = (await searchParams).periode === PAST;
  const agenda = getAgenda();
  const [t, locale, days, unscheduled, applications] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    agenda.days(candidate.id, { period: past ? "past" : "upcoming", now: new Date() }),
    agenda.unscheduled(candidate.id),
    getApplications().list(candidate.id),
  ]);
  // The Application picker offers the ongoing Applications only: not the Archived ones.
  const ongoing: InterviewableApplication[] = applications
    .filter((application) => !isArchivedApplication(application))
    .map(({ id, status, jobOffer }) => ({ id, status, jobTitle: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}) }));
  const dayTitle = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const paidOn = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")}>
      <div className="agenda-actions">
        <AddInterviewDialog applications={ongoing} />
      </div>
      {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} formatDate={(value) => paidOn.format(value)} t={t} /> : null}
      <section className={past ? "agenda agenda-past" : "agenda"} aria-labelledby="agenda-period-title">
        <div className="section-head">
          <h2 id="agenda-period-title">{t(past ? "agenda.pastTitle" : "agenda.upcomingTitle")}</h2>
          <Link href={routes.agenda(!past)}>{t(past ? "agenda.showUpcoming" : "agenda.showPast")}</Link>
        </div>
        {days.length === 0 ? (
          <p className="notice">{t(past ? "agenda.nonePast" : "agenda.none")}</p>
        ) : (
          days.map((day) => <Day key={day.day} day={day} title={dayTitle.format(day.items[0]!.scheduledAt)} time={time} t={t} />)
        )}
      </section>
    </CandidateLayout>
  );
}

/** One day of the Agenda: its date as a heading, then its items. */
function Day({ day, title, time, t }: { day: AgendaDay; title: string; time: Intl.DateTimeFormat; t: T }) {
  const titleId = `agenda-day-${day.day}`;
  return (
    <section className="agenda-day" aria-labelledby={titleId}>
      <h3 id={titleId}>
        <time dateTime={day.day}>{title}</time>
      </h3>
      <ul className="agenda-items">
        {day.items.map((item) => (
          <Item key={`${item.kind}-${item.id}`} item={item} time={time} t={t} />
        ))}
      </ul>
    </section>
  );
}

/**
 * « À planifier »: the Unscheduled Coaching Sessions, paid but with no date yet. Each names its
 * Human Coach, leads to their Cal.com booking page and lets the Candidate enter the date booked.
 */
function ToSchedule({ sessions, formatDate, t }: { sessions: UnscheduledCoachingSession[]; formatDate: (value: Date) => string; t: T }) {
  return (
    <section className="agenda-to-schedule" aria-labelledby="agenda-to-schedule-title">
      <h2 id="agenda-to-schedule-title">{t("agenda.toSchedule")}</h2>
      <p>{t("agenda.toScheduleIntro")}</p>
      <ul className="agenda-items">
        {sessions.map((session) => (
          <li key={session.id} className="agenda-unscheduled">
            <p className="agenda-item-title">{t("humanCoaches.sessionPaidOn", { name: session.coach.name, date: formatDate(session.paidAt) })}</p>
            <div className="actions">
              <a className="button button-primary" href={session.coach.bookingUrl} rel="noopener noreferrer" target="_blank">
                {t("humanCoaches.pickSlot", { name: session.coach.name })}
              </a>
              <CoachingSessionDialog session={{ id: session.id, scheduledAt: "", durationMinutes: null, videoLink: null, note: null }} coachName={session.coach.name} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One Agenda Item: an Interview or a dated Coaching Session. */
function Item({ item, time, t }: { item: AgendaItem; time: Intl.DateTimeFormat; t: T }) {
  return item.kind === "interview" ? <InterviewItem item={item} time={time} t={t} /> : <CoachingSessionItem item={item} time={time} t={t} />;
}

/** A dated Coaching Session: its time, its Human Coach and duration, leading to them on the Human Coaches page; its date can be edited here. */
function CoachingSessionItem({ item, time, t }: { item: CoachingSessionAgendaItem; time: Intl.DateTimeFormat; t: T }) {
  return (
    <li className="agenda-item agenda-item-with-action">
      <Link className="agenda-item-link" href={routes.coachingSession(item.id)}>
        <time className="agenda-item-time" dateTime={item.scheduledAt.toISOString()}>
          {time.format(item.scheduledAt)}
        </time>
        <span className="agenda-item-what">
          <span className="agenda-item-kind">{t("agenda.coachingSession")}</span>
          <span className="agenda-item-title">{t("agenda.withCoach", { name: item.coach.name })}</span>
          {item.durationMinutes ? <span className="agenda-item-employer">{t("agenda.duration", { count: item.durationMinutes })}</span> : null}
        </span>
      </Link>
      <CoachingSessionDialog
        session={{ id: item.id, scheduledAt: interviewWallClock(item.scheduledAt), durationMinutes: item.durationMinutes ?? null, videoLink: item.videoLink ?? null, note: item.note ?? null }}
        coachName={item.coach.name}
        className="button button-quiet"
      />
    </li>
  );
}

/**
 * An Interview: its start and end times and the Job Offer's title and company, leading to
 * its Application's Interviews Section; then its format and place, a link in it clickable.
 */
function InterviewItem({ item, time, t }: { item: InterviewAgendaItem; time: Intl.DateTimeFormat; t: T }) {
  return (
    <li className="agenda-item">
      <Link className="agenda-item-link" href={routes.applicationSection(item.applicationId, INTERVIEWS)}>
        <span className="agenda-item-time">
          <InterviewTimes interview={item} time={time} />
        </span>
        <span className="agenda-item-what">
          <span className="agenda-item-kind">{t("agenda.interview")}</span>
          <span className="agenda-item-title">{item.jobTitle}</span>
          {item.employer ? <span className="agenda-item-employer">{item.employer}</span> : null}
        </span>
      </Link>
      <InterviewFacts interview={item} t={t} />
    </li>
  );
}
