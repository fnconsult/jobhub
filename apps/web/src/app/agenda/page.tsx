import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { AgendaDay, AgendaItem } from "@/agenda";
import { getAgenda } from "@/agenda/server";
import { INTERVIEW_TIME_ZONE } from "@/applications";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
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
 * dimmed. Each item leads to its Application's Interviews Section.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ periode?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const past = (await searchParams).periode === PAST;
  const [t, locale, days] = await Promise.all([getServerT(), getRequestLocale(), getAgenda().days(candidate.id, { period: past ? "past" : "upcoming", now: new Date() })]);
  const dayTitle = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: INTERVIEW_TIME_ZONE });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: INTERVIEW_TIME_ZONE });
  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")}>
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

/** An Interview: its time, the Job Offer's title and company, leading to its Application's Interviews Section. */
function Item({ item, formatTime, t }: { item: AgendaItem; formatTime: (value: Date) => string; t: T }) {
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
