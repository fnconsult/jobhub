import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgendaDay, AgendaItem, CoachingSessionAgendaItem, InterviewAgendaItem, UnscheduledCoachingSession } from "@/agenda";
import { agendaPeriod } from "@/agenda";
import { calendarPeriod, frenchDay, readAgendaAddress, type AgendaView, type CalendarPeriod, type CalendarView } from "@/agenda/calendar";
import { getAgenda } from "@/agenda/server";
import { INTERVIEW_TIME_ZONE, interviewWallClock } from "@/applications";
import { isArchivedApplication } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { AgendaDayButton, AgendaViewMemory } from "@/components/AgendaControls";
import { AddInterviewDialog, type InterviewableApplication } from "@/components/AddInterviewDialog";
import { CancelAgendaItemButton } from "@/components/CancelAgendaItemButton";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { CoachingSessionDialog } from "@/components/CoachingSessionDialog";
import { InterviewFacts, InterviewTimes } from "@/components/InterviewDetails";
import { RescheduleHistory } from "@/components/RescheduleHistory";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes, type ApplicationSection } from "@/routes";

/** Where an Interview leads: its Application's Interviews Section. */
const INTERVIEWS: ApplicationSection = "entretiens";
/** What the AI Coach has In view here: the Agenda (its next 30 days, whichever period is shown). */
const AGENDA_IN_VIEW = { kind: "agenda", id: "agenda" } as const;
/** The address's value for the past Agenda Items (see routes.agenda). */
const PAST = "passes";
/** `aria-current` of the link to the view shown. */
const CURRENT = "page";
/** How many markers a day of the month grid shows before « +n ». */
const MARKERS = 3;
/** The address's values for the week and month views. */
const WEEK: CalendarView = "semaine";
const MONTH: CalendarView = "mois";

type T = Awaited<ReturnType<typeof getServerT>>;
type SearchParams = { vue?: string | string[]; date?: string | string[]; periode?: string | string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("agenda.title")} · ${t("app.name")}` };
}

/** How the page writes days and times: in French time, in the Interface Language. */
interface Formats {
  /** The time formatter, for `InterviewTimes`: "14:30". */
  timeFormat: Intl.DateTimeFormat;
  /** "14:30". */
  time: (value: Date) => string;
  /** A calendar day ("2026-10-22") in full: "jeudi 22 octobre 2026". */
  fullDay: (day: string) => string;
  /** "jeudi 22 octobre". */
  weekday: (day: string) => string;
  /** "jeudi". */
  weekdayName: (day: string) => string;
  /** "jeu.". */
  weekdayShort: (day: string) => string;
  /** "22". */
  dayNumber: (day: string) => string;
  /** The month a day is in: "octobre 2026". */
  month: (day: string) => string;
  /** The days from `first` to `last` ("19–25 octobre 2026"). */
  range: (first: string, last: string) => string;
  /** Whether an Agenda Item is past: before today, as in the list. */
  isPast: (item: AgendaItem) => boolean;
  /** When a date changed, and the dates changed from and to: "22 octobre 2026 à 14:30". */
  changedAt: Intl.DateTimeFormat;
  /** The day an item was cancelled, or a session paid: "22 octobre 2026". */
  day: Intl.DateTimeFormat;
}

/** A calendar day at noon UTC: always that same day in French time, so `Intl` writes it in Europe/Paris. */
const noonOf = (day: string) => new Date(`${day}T12:00:00Z`);

function formatsFor(locale: string, now: Date): Formats {
  const zone = { timeZone: INTERVIEW_TIME_ZONE };
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", ...zone });
  const dayIn = (options: Intl.DateTimeFormatOptions) => {
    const format = new Intl.DateTimeFormat(locale, { ...options, ...zone });
    return (day: string) => format.format(noonOf(day));
  };
  const range = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", ...zone });
  return {
    timeFormat: time,
    time: (value) => time.format(value),
    fullDay: dayIn({ dateStyle: "full" }),
    weekday: dayIn({ weekday: "long", day: "numeric", month: "long" }),
    weekdayName: dayIn({ weekday: "long" }),
    weekdayShort: dayIn({ weekday: "short" }),
    dayNumber: dayIn({ day: "numeric" }),
    month: dayIn({ month: "long", year: "numeric" }),
    range: (first, last) => range.formatRange(noonOf(first), noonOf(last)),
    isPast: (item) => agendaPeriod(item.scheduledAt, now) === "past",
    changedAt: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", ...zone }),
    day: new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone }),
  };
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
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const params = await searchParams;
  const now = new Date();
  const address = readAgendaAddress(params, now);
  const past = address.view === "liste" && params.periode === PAST;
  const agenda = getAgenda();
  const [t, locale, unscheduled, applications] = await Promise.all([getServerT(), getRequestLocale(), agenda.unscheduled(candidate.id), getApplications().list(candidate.id)]);
  // The Application picker offers the ongoing Applications only: not the Archived ones.
  const ongoing: InterviewableApplication[] = applications
    .filter((application) => !isArchivedApplication(application))
    .map(({ id, status, jobOffer }) => ({ id, status, jobTitle: jobOffer.title, ...(jobOffer.employer ? { employer: jobOffer.employer } : {}) }));
  const formats = formatsFor(locale, now);
  const today = frenchDay(now);

  let content;
  if (address.view === "liste") {
    const days = await agenda.days(candidate.id, { period: past ? "past" : "upcoming", now });
    content = <AgendaList days={days} past={past} formats={formats} t={t} />;
  } else {
    const period = calendarPeriod(address.view, address.date);
    const byDay = new Map((await agenda.daysBetween(candidate.id, period)).map((day) => [day.day, day.items]));
    content =
      address.view === "semaine" ? (
        <AgendaWeek period={period} byDay={byDay} today={today} formats={formats} t={t} />
      ) : (
        <AgendaMonth period={period} byDay={byDay} selected={address.date} today={today} formats={formats} t={t} />
      );
  }

  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")} wide={address.view === "semaine"}>
      {/* An address naming no view (the Sidebar's link) brings back the one last picked. */}
      <AgendaViewMemory view={address.view} restore={!address.chosen && params.periode === undefined} />
      <div className="agenda-actions">
        <AddInterviewDialog applications={ongoing} />
      </div>
      <ViewSwitch view={address.view} date={address.date} t={t} />
      <CoachInView {...AGENDA_IN_VIEW} name={t("agenda.title")} />
      {unscheduled.length > 0 ? <ToSchedule sessions={unscheduled} formats={formats} t={t} /> : null}
      {content}
    </CandidateLayout>
  );
}

/** « Liste », « Semaine », « Mois »: links styled as a segmented control, the view shown `aria-current`. Week and month keep the day shown. */
function ViewSwitch({ view, date, t }: { view: AgendaView; date: string; t: T }) {
  const views: { view: AgendaView; href: string; label: string }[] = [
    { view: "liste", href: routes.agendaList(), label: t("agenda.listView") },
    { view: "semaine", href: routes.agendaCalendar("semaine", date), label: t("agenda.weekView") },
    { view: "mois", href: routes.agendaCalendar("mois", date), label: t("agenda.monthView") },
  ];
  return (
    <nav className="agenda-views" aria-label={t("agenda.viewsLabel")}>
      {views.map((option) => (
        <Link key={option.view} href={option.href} aria-current={option.view === view ? CURRENT : undefined}>
          {option.label}
        </Link>
      ))}
    </nav>
  );
}

/** The list: upcoming Agenda Items by day, oldest first, or the past ones, newest first and dimmed. */
function AgendaList({ days, past, formats, t }: { days: AgendaDay[]; past: boolean; formats: Formats; t: T }) {
  return (
    <section className={past ? "agenda agenda-past" : "agenda"} aria-labelledby="agenda-period-title">
      <div className="section-head">
        <h2 id="agenda-period-title">{t(past ? "agenda.pastTitle" : "agenda.upcomingTitle")}</h2>
        <Link href={routes.agendaList(!past)}>{t(past ? "agenda.showUpcoming" : "agenda.showPast")}</Link>
      </div>
      {days.length === 0 ? (
        <p className="notice">{t(past ? "agenda.nonePast" : "agenda.none")}</p>
      ) : (
        days.map((day) => {
          const titleId = `agenda-day-${day.day}`;
          return (
            <section key={day.day} className="agenda-day" aria-labelledby={titleId}>
              <h3 id={titleId}>
                <time dateTime={day.day}>{formats.fullDay(day.day)}</time>
              </h3>
              <Items items={day.items} formats={formats} t={t} />
            </section>
          );
        })
      )}
    </section>
  );
}

/** « Précédent », « Aujourd'hui », « Suivant » for a week or a month. */
function PeriodNav({ view, period, today, t }: { view: CalendarView; period: CalendarPeriod; today: string; t: T }) {
  return (
    <nav className="actions agenda-period-nav" aria-label={t(view === "semaine" ? "agenda.weekNavLabel" : "agenda.monthNavLabel")}>
      <Link className="button" href={routes.agendaCalendar(view, period.previous)}>
        {t("agenda.previous")}
      </Link>
      <Link className="button" href={routes.agendaCalendar(view, today)}>
        {t("agenda.today")}
      </Link>
      <Link className="button" href={routes.agendaCalendar(view, period.next)}>
        {t("agenda.next")}
      </Link>
    </nav>
  );
}

/** The week: Monday to Sunday, one column per day with its items and their time, no hourly grid; the days stacked on phones. */
function AgendaWeek({ period, byDay, today, formats, t }: { period: CalendarPeriod; byDay: Map<string, AgendaItem[]>; today: string; formats: Formats; t: T }) {
  return (
    <section className="agenda agenda-calendar" aria-labelledby="agenda-period-title">
      <div className="section-head">
        <h2 id="agenda-period-title" className="agenda-period-title">
          {t("agenda.weekTitle", { range: formats.range(period.first, period.last) })}
        </h2>
        <PeriodNav view={WEEK} period={period} today={today} t={t} />
      </div>
      <ol className="agenda-week">
        {period.weeks[0]!.map((day) => {
          const items = byDay.get(day) ?? [];
          const titleId = `agenda-day-${day}`;
          return (
            <li key={day} className={day === today ? "agenda-week-day agenda-today" : "agenda-week-day"}>
              <section aria-labelledby={titleId}>
                <h3 id={titleId}>
                  <time dateTime={day} aria-current={day === today ? "date" : undefined}>
                    {formats.weekday(day)}
                  </time>
                </h3>
                {items.length === 0 ? <p className="agenda-nothing">{t("agenda.nothing")}</p> : <Items items={items} formats={formats} t={t} />}
              </section>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * The month: a table of days, Monday first, with a marker per item (a disc for an Interview,
 * a hollow diamond for a Coaching Session: told apart by shape, not colour alone). Each day is a
 * button, reached by Tab, that names its date and its number of items; the day chosen (the
 * address's date) lists its items below the grid. The buttons submit a GET form, so they work
 * without JavaScript too.
 */
function AgendaMonth({ period, byDay, selected, today, formats, t }: { period: CalendarPeriod; byDay: Map<string, AgendaItem[]>; selected: string; today: string; formats: Formats; t: T }) {
  const chosen = byDay.get(selected) ?? [];
  return (
    <section className="agenda agenda-calendar" aria-labelledby="agenda-period-title">
      <div className="section-head">
        <h2 id="agenda-period-title" className="agenda-period-title">
          {formats.month(period.first)}
        </h2>
        <PeriodNav view={MONTH} period={period} today={today} t={t} />
      </div>
      <form method="get" action="/agenda">
        <input type="hidden" name="vue" value={MONTH} />
        <table className="agenda-month" aria-labelledby="agenda-period-title">
          <thead>
            <tr>
              {period.weeks[0]!.map((day) => (
                <th key={day} scope="col">
                  <abbr title={formats.weekdayName(day)}>{formats.weekdayShort(day)}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {period.weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  if (day < period.first || day > period.last) return <td key={day} className="agenda-month-outside" />;
                  const items = byDay.get(day) ?? [];
                  return (
                    <td key={day}>
                      <AgendaDayButton
                        day={day}
                        href={routes.agendaCalendar(MONTH, day)}
                        label={t("agenda.dayItems", { date: formats.weekday(day), count: items.length })}
                        selected={day === selected}
                        today={day === today}
                        className={monthDayClass(day, today)}
                      >
                        <span className="agenda-month-number">{formats.dayNumber(day)}</span>
                        {items.length > 0 ? (
                          <span className="agenda-markers" aria-hidden="true">
                            {items.slice(0, MARKERS).map((item) => (
                              <span key={`${item.kind}-${item.id}`} className={`agenda-marker agenda-marker-${item.kind}`} />
                            ))}
                            {items.length > MARKERS ? <span className="agenda-markers-more">+{items.length - MARKERS}</span> : null}
                          </span>
                        ) : null}
                      </AgendaDayButton>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </form>
      <ul className="agenda-legend" aria-label={t("agenda.legendLabel")}>
        <li>
          <span className="agenda-marker agenda-marker-interview" aria-hidden="true" />
          {t("agenda.interview")}
        </li>
        <li>
          <span className="agenda-marker agenda-marker-coachingSession" aria-hidden="true" />
          {t("agenda.coachingSession")}
        </li>
      </ul>
      <section className="agenda-day" aria-labelledby="agenda-chosen-day-title" aria-live="polite">
        <h3 id="agenda-chosen-day-title">
          <time dateTime={selected}>{formats.fullDay(selected)}</time>
        </h3>
        {chosen.length === 0 ? <p className="agenda-nothing">{t("agenda.nothingThatDay")}</p> : <Items items={chosen} formats={formats} t={t} />}
      </section>
    </section>
  );
}

/** A day button of the month grid: dimmed before today, today ringed. */
function monthDayClass(day: string, today: string): string {
  return ["agenda-month-day", day < today ? "agenda-month-day-past" : "", day === today ? "agenda-today" : ""].filter(Boolean).join(" ");
}

/**
 * « À planifier »: the Unscheduled Coaching Sessions, paid but with no date yet, or cancelled. Each names its
 * Human Coach, leads to their Cal.com booking page and lets the Candidate enter the date booked; a cancelled
 * one keeps its history.
 */
function ToSchedule({ sessions, formats, t }: { sessions: UnscheduledCoachingSession[]; formats: Formats; t: T }) {
  return (
    <section className="agenda-to-schedule" aria-labelledby="agenda-to-schedule-title">
      <h2 id="agenda-to-schedule-title">{t("agenda.toSchedule")}</h2>
      <p>{t("agenda.toScheduleIntro")}</p>
      <ul className="agenda-items">
        {sessions.map((session) => (
          <li key={session.id} className="agenda-unscheduled">
            <p className="agenda-item-title">{t("humanCoaches.sessionPaidOn", { name: session.coach.name, date: formats.day.format(session.paidAt) })}</p>
            <RescheduleHistory reschedules={session.reschedules} coachName={session.coach.name} dateTime={formats.changedAt} t={t} />
            <div className="actions">
              <a className="button button-primary" href={session.coach.bookingUrl} rel="noopener noreferrer" target="_blank">
                {t("humanCoaches.pickSlot", { name: session.coach.name })}
              </a>
              <CoachingSessionDialog session={{ id: session.id, scheduledAt: "", durationMinutes: null, videoLink: null, note: null }} withName={session.coach.name} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A day's Agenda Items, each with its time; the past ones dimmed. */
function Items({ items, formats, t }: { items: AgendaItem[]; formats: Formats; t: T }) {
  return (
    <ul className="agenda-items">
      {items.map((item) =>
        item.kind === "interview" ? (
          <InterviewItem key={`${item.kind}-${item.id}`} item={item} past={formats.isPast(item)} formats={formats} t={t} />
        ) : (
          <CoachingSessionItem key={`${item.kind}-${item.id}`} item={item} past={formats.isPast(item)} formats={formats} t={t} />
        ),
      )}
    </ul>
  );
}

/**
 * A dated Coaching Session: its time, its Human Coach and duration, and « modifié par le coach » when
 * the Human Coach was the last to change its date, leading to them on the Human Coaches page;
 * its Reschedule history, and its date can be edited, or the session cancelled, here.
 */
function CoachingSessionItem({ item, past, formats, t }: { item: CoachingSessionAgendaItem; past: boolean; formats: Formats; t: T }) {
  return (
    <li className={past ? "agenda-item agenda-item-with-action agenda-item-past" : "agenda-item agenda-item-with-action"}>
      <Link className="agenda-item-link" href={routes.coachingSession(item.id)}>
        <time className="agenda-item-time" dateTime={item.scheduledAt.toISOString()}>
          {formats.time(item.scheduledAt)}
        </time>
        <span className="agenda-item-what">
          <span className="agenda-item-kind">
            <span className="agenda-marker agenda-marker-coachingSession" aria-hidden="true" />
            {t("agenda.coachingSession")}
          </span>
          <span className="agenda-item-title">{t("agenda.withCoach", { name: item.coach.name })}</span>
          {item.durationMinutes ? <span className="agenda-item-employer">{t("agenda.duration", { count: item.durationMinutes })}</span> : null}
          {item.changedBy === "coach" ? <span className="agenda-item-changed">{t("agenda.changedByCoach")}</span> : null}
        </span>
      </Link>
      <CoachingSessionDialog
        session={{ id: item.id, scheduledAt: interviewWallClock(item.scheduledAt), durationMinutes: item.durationMinutes ?? null, videoLink: item.videoLink ?? null, note: item.note ?? null }}
        withName={item.coach.name}
        className="button button-quiet"
      />
      <RescheduleHistory reschedules={item.reschedules} coachName={item.coach.name} dateTime={formats.changedAt} t={t} />
      <CancelAgendaItemButton
        url={`/api/coaching/sessions/${item.id}/cancel`}
        label={t("agendaChanges.cancelSession")}
        name={t("agendaChanges.cancelSessionFor", { name: item.coach.name })}
        question={t("agendaChanges.cancelSessionConfirm")}
      />
    </li>
  );
}

/**
 * An Interview: its start and end times and the Job Offer's title and company, leading to
 * its Application's Interviews Section; then its format and place, a link in it clickable,
 * and its Reschedule history. A Cancelled Interview is struck through, with its date of cancellation.
 */
function InterviewItem({ item, past, formats, t }: { item: InterviewAgendaItem; past: boolean; formats: Formats; t: T }) {
  const className = ["agenda-item", past ? "agenda-item-past" : "", item.cancelledAt ? "agenda-item-cancelled" : ""].filter(Boolean).join(" ");
  return (
    <li className={className}>
      <Link className="agenda-item-link" href={routes.applicationSection(item.applicationId, INTERVIEWS)}>
        <span className="agenda-item-time">
          <InterviewTimes interview={item} time={formats.timeFormat} />
        </span>
        <span className="agenda-item-what">
          <span className="agenda-item-kind">
            <span className="agenda-marker agenda-marker-interview" aria-hidden="true" />
            {t(item.cancelledAt ? "agendaChanges.cancelledInterview" : "agenda.interview")}
          </span>
          <span className="agenda-item-title">{item.jobTitle}</span>
          {item.employer ? <span className="agenda-item-employer">{item.employer}</span> : null}
        </span>
      </Link>
      {item.cancelledAt ? <p className="cancelled-on">{t("agendaChanges.cancelledOn", { date: formats.day.format(item.cancelledAt) })}</p> : null}
      <InterviewFacts interview={item} t={t} />
      <RescheduleHistory reschedules={item.reschedules} dateTime={formats.changedAt} t={t} />
    </li>
  );
}
