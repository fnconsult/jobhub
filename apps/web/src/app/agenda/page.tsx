import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgendaDay, AgendaItem, CoachingSessionAgendaItem, InterviewAgendaItem, UnscheduledCoachingSession } from "@/agenda";
import { getAgenda } from "@/agenda/server";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachingSessionDialog } from "@/components/CoachingSessionDialog";
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
 * dimmed. An Interview leads to its Application's Interviews Section, a Coaching
 * Session to its Human Coach on the Human Coaches page. Unscheduled Coaching
 * Sessions sit at the top, « À planifier », with each Human Coach's booking link.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const past = (await searchParams).periode === PAST;
  const agenda = getAgenda();
  const [t, locale, days, unscheduled] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    agenda.days(candidate.id, { period: past ? "past" : "upcoming", now: new Date() }),
    agenda.unscheduled(candidate.id),
  ]);
  const dayTitle = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  const paidOn = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: INTERVIEW_TIME_ZONE });
  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")}>
      {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} formatDate={(value) => paidOn.format(value)} t={t} /> : null}
      <section className={past ? "agenda agenda-past" : "agenda"} aria-labelledby="agenda-period-title">
        <div className="section-head">
          <h2 id="agenda-period-title">{t(past ? "agenda.pastTitle" : "agenda.upcomingTitle")}</h2>
          <Link href={routes.agenda(!past)}>{t(past ? "agenda.showUpcoming" : "agenda.showPast")}</Link>
        </div>
        {days.length === 0 ? (
          <p className="notice">{t(past ? "agenda.nonePast" : "agenda.none")}</p>
        ) : (
          days.map((day) => <Day key={day.day} day={day} title={dayTitle.format(day.items[0]!.scheduledAt)} formatTime={(value) => time.format(value)} t={t} />)
        )}
      </section>
    </CandidateLayout>
  );
}

/** One day of the Agenda: its date as a heading, then its items. */
function Day({ day, title, formatTime, t }: { day: AgendaDay; title: string; formatTime: (value: Date) => string; t: T }) {
  const titleId = `agenda-day-${day.day}`;
  return (
    <section className="agenda-day" aria-labelledby={titleId}>
      <h3 id={titleId}>
        <time dateTime={day.day}>{title}</time>
      </h3>
      <ul className="agenda-items">
        {day.items.map((item) => (
          <Item key={`${item.kind}-${item.id}`} item={item} formatTime={formatTime} t={t} />
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
function Item({ item, formatTime, t }: { item: AgendaItem; formatTime: (value: Date) => string; t: T }) {
  return item.kind === "interview" ? <InterviewItem item={item} formatTime={formatTime} t={t} /> : <CoachingSessionItem item={item} formatTime={formatTime} t={t} />;
}

/** A dated Coaching Session: its time, its Human Coach and duration, leading to them on the Human Coaches page; its date can be edited here. */
function CoachingSessionItem({ item, formatTime, t }: { item: CoachingSessionAgendaItem; formatTime: (value: Date) => string; t: T }) {
  return (
    <li className="agenda-item agenda-item-with-action">
      <Link className="agenda-item-link" href={routes.coachingSession(item.id)}>
        <time className="agenda-item-time" dateTime={item.scheduledAt.toISOString()}>
          {formatTime(item.scheduledAt)}
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

/** An Interview: its time, the Job Offer's title and company, leading to its Application's Interviews Section. */
function InterviewItem({ item, formatTime, t }: { item: InterviewAgendaItem; formatTime: (value: Date) => string; t: T }) {
  return (
    <li className="agenda-item">
      <Link className="agenda-item-link" href={routes.applicationSection(item.applicationId, INTERVIEWS)}>
        <time className="agenda-item-time" dateTime={item.scheduledAt.toISOString()}>
          {formatTime(item.scheduledAt)}
        </time>
        <span className="agenda-item-what">
          <span className="agenda-item-kind">{t("agenda.interview")}</span>
          <span className="agenda-item-title">{item.jobTitle}</span>
          {item.employer ? <span className="agenda-item-employer">{item.employer}</span> : null}
        </span>
      </Link>
    </li>
  );
}
