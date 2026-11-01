import Link from "next/link";
import { getCoachConversations } from "@/coach-conversations/server";
import { CoachConversationPage } from "@/components/CoachPanel";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { JobDigestFrequency } from "@/components/JobDigestSettings";
import { Card } from "@/design/Card";
import { Table, type Column } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import type { JobDigestSettings, ListedJobDigest } from "@/job-digests";
import { jobDigestsMenu, type JobDigestsMenuGroup } from "@/job-digests/menu";
import { getJobDigests } from "@/job-digests/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { objectDay } from "@/sidebar-menus";
import "./MenuCards.css";

type T = Awaited<ReturnType<typeof getServerT>>;

/** The Job Digests' Subject: the menu's one conversation per Candidate (ADR-0070). */
const SUBJECT = { kind: "menu", id: "jobDigests" } as const;
/** The card's title, which names it. */
const CARD_TITLE_ID = "job-digests-menu-title";

/**
 * Job Digests under « Conversation au centre » (#606, ADR-0070): the menu's conversation, one per Candidate, as the page.
 * Its Introduction says what the page is for; the Job Digests, by active Profile, are a card in the thread: how often
 * each Profile's is sent and the way to change it, then every one sent (when, how many Job Offers), each line to its page.
 */
export async function JobDigestsMenuPage({ candidateId }: { candidateId: string }) {
  const [t, locale, profiles, digests, subject] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getProfiles().list(candidateId),
    getJobDigests().list(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
  ]);
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const settings = new Map(await Promise.all(active.map(async (profile) => [profile.id, await getJobDigests().settings(candidateId, profile.id)] as const)));
  const menu = jobDigestsMenu({ profiles: active, digests, dateLabel: objectDay(locale) });
  const conversationId = subject.ok ? (subject.conversation?.id ?? null) : null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "Europe/Paris" });
  return (
    <CoachConversationPage
      key={conversationId ?? "new"}
      conversationId={conversationId}
      subject={SUBJECT}
      introduction={<p>{t("jobDigestsMenu.introduction")}</p>}
      card={<JobDigestsCard groups={menu.groups} settings={settings} date={date} t={t} />}
    />
  );
}

/** The Job Digests by active Profile, a card in the menu's thread. */
function JobDigestsCard({ groups, settings, date, t }: { groups: JobDigestsMenuGroup[]; settings: ReadonlyMap<string, JobDigestSettings | null>; date: Intl.DateTimeFormat; t: T }) {
  const columns: Column<ListedJobDigest>[] = [
    { key: "sentAt", header: t("jobDigestsMenu.sentOn"), rowHeader: true, cell: (digest) => <Link href={routes.jobDigest(digest.id)}>{date.format(digest.sentAt)}</Link> },
    { key: "count", header: t("jobDigestsMenu.count"), numeric: true, cell: (digest) => digest.count },
  ];
  return (
    <Card title={t("jobDigestsMenu.title")} headingId={CARD_TITLE_ID}>
      <p>{t("jobDigest.hint")}</p>
      {groups.length === 0 ? (
        <p>
          {t("profiles.none")} <Link href={routes.newProfile}>{t("profiles.create")}</Link> <EmptyStateHelp of="profiles" />
        </p>
      ) : (
        groups.map(({ profile, digests }) => {
          const jobDigest = settings.get(profile.id);
          return (
            <section key={profile.id} className="menu-card-group" aria-labelledby={`job-digests-of-${profile.id}`}>
              <h3 id={`job-digests-of-${profile.id}`}>
                <Link href={routes.profile(profile.id)}>{profile.name}</Link>
              </h3>
              {jobDigest ? <JobDigestFrequency profileId={profile.id} jobDigest={jobDigest} t={t} /> : null}
              {digests.length === 0 ? (
                <p>{t("jobDigestsMenu.none")}</p>
              ) : (
                <Table label={t("jobDigestsMenu.tableLabel", { profile: profile.name })} columns={columns} rows={digests} rowKey={(digest) => digest.id} data-row-links="" />
              )}
            </section>
          );
        })
      )}
    </Card>
  );
}
