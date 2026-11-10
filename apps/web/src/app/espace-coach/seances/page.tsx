import Link from "next/link";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { requireCoachSpaceV2 } from "@/coach-space/server";
import { getCoachWorkspace } from "@/coach-space/workspace-server";
import { SessionCard } from "@/coach-space/SessionCard";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
const CURRENT = "page";
const TABS = ["upcoming", "unscheduled", "past"] as const;
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const coach = await requireCoachSpaceV2();
  const [t, locale, timeZone, all, params] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getCoachingTimeZones().coach(coach.id),
    getCoachWorkspace().sessions(coach.id),
    searchParams,
  ]);
  const now = +new Date();
  const groups = {
    upcoming: all.filter((s) => s.scheduledAt && +s.scheduledAt + (s.durationMinutes ?? 60) * 60_000 >= now).sort((a, b) => +a.scheduledAt! - +b.scheduledAt!),
    unscheduled: all.filter((s) => !s.scheduledAt),
    past: all.filter((s) => s.scheduledAt && +s.scheduledAt + (s.durationMinutes ?? 60) * 60_000 < now),
  };
  const tab = TABS.find((tab) => tab === params.tab) ?? "upcoming";
  return (
    <CoachSpaceShell>
      <nav className="actions" aria-label={t("coachSpaceV2.pages.seances")}>
        {TABS.map((key) => (
          <Link key={key} href={`/espace-coach/seances?tab=${key}`} aria-current={tab === key ? CURRENT : undefined}>
            {t(`coachWorkspace.tabs.${key}`)} ({groups[key].length})
          </Link>
        ))}
      </nav>
      {groups[tab].length ? (
        groups[tab].map((session) => <SessionCard coachId={coach.id} key={session.id} session={session} t={t} locale={locale} timeZone={timeZone} />)
      ) : (
        <p>{t("coachSpaceV2.empty.seances")}</p>
      )}
    </CoachSpaceShell>
  );
}
