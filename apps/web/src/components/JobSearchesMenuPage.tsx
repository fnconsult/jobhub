import Link from "next/link";
import { getCoachConversations } from "@/coach-conversations/server";
import { CoachConversationPage } from "@/components/CoachPanel";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { RefreshWhileSearching } from "@/components/JobSearchControls";
import { JobSearchesMenuSuggestions } from "@/components/JobSearchesMenuSuggestions";
import { EmailIntakeStanding, ReceivedByEmail } from "@/components/ReceivedByEmail";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { EmptyState } from "@/design/EmptyState";
import { Pill, type Tone } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { emailIntakeLimits } from "@/email-intake/domain";
import { getCandidateSenders, getEmailIntake, getReceivedOffers } from "@/email-intake/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import type { JobSearchStatus, JobSearchSummary } from "@/job-searches";
import { jobSearchesMenu, type JobSearchesMenuGroup } from "@/job-searches/menu";
import { getJobSearches } from "@/job-searches/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { objectDay } from "@/sidebar-menus";
import "./MenuCards.css";

type T = Awaited<ReturnType<typeof getServerT>>;
type Profile = { id: string; name: string };

/** Recherches d'offres' Subject: the menu's one conversation per Candidate (ADR-0070). */
const SUBJECT = { kind: "menu", id: "jobSearches" } as const;
/** The card's title, which names it. */
const CARD_TITLE_ID = "job-searches-menu-title";

/** « Reçues par email » in the Work Pane: a Section of Recherches d'offres. */
const RECEIVED: AddressedKind = "section";

/** A Job Search's outcome, tinted; its words carry the meaning. */
const STATUS_TONES: Record<JobSearchStatus, Tone> = { searching: "accent", done: "success", failed: "danger", stopped: "neutral" };

/**
 * Recherches d'offres under « Conversation au centre » (#606, ADR-0070): the menu's conversation, one per Candidate, as
 * the page. Its Introduction says what the page is for; the Job Searches, by active Profile (when, where each stands, the
 * Job Offers it found, those still unseen), are a card in the thread, each line to its Job Search. « Lancer une recherche »
 * is a suggestion above the box. « Reçues par email » (#447) opens in the Work Pane (`received`), at its own address.
 * While a Job Search is under way, the page refreshes itself until it ends.
 */
export async function JobSearchesMenuPage({ candidateId, received }: { candidateId: string; received: boolean }) {
  const [t, locale, profiles, searches, subject] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getProfiles().list(candidateId),
    getJobSearches().list(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
  ]);
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const menu = jobSearchesMenu({ profiles: active, searches, dateLabel: objectDay(locale) });
  const conversationId = subject.ok ? (subject.conversation?.id ?? null) : null;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
  return (
    <>
      <CoachConversationPage
        key={conversationId ?? "new"}
        conversationId={conversationId}
        subject={SUBJECT}
        introduction={<p>{t("jobSearchesMenu.introduction")}</p>}
        card={<JobSearchesCard groups={menu.groups} unseen={menu.unseen} date={date} t={t} />}
        suggestions={<JobSearchesMenuSuggestions profiles={active} />}
      />
      {searches.some((search) => search.status === "searching") ? <RefreshWhileSearching /> : null}
      {received ? <ReceivedByEmailPane candidateId={candidateId} profiles={active} t={t} locale={locale} /> : null}
    </>
  );
}

/** The Job Searches by active Profile, a card in the menu's thread. */
function JobSearchesCard({ groups, unseen, date, t }: { groups: JobSearchesMenuGroup[]; unseen: number; date: Intl.DateTimeFormat; t: T }) {
  const columns: Column<JobSearchSummary>[] = [
    { key: "startedAt", header: t("jobSearch.startedOn"), rowHeader: true, cell: (search) => <Link href={routes.jobSearch(search.id)}>{date.format(search.startedAt)}</Link> },
    { key: "status", header: t("jobSearch.status"), cell: (search) => <Pill tone={STATUS_TONES[search.status]}>{t(`jobSearch.statuses.${search.status}`)}</Pill> },
    {
      key: "found",
      header: t("jobSearchesMenu.found"),
      numeric: true,
      cell: (search) =>
        search.status === "searching" ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="visually-hidden">{t("jobSearchesMenu.stillSearching")}</span>
          </>
        ) : (
          search.found
        ),
    },
    { key: "unseen", header: t("applicationsMenu.toHandleColumn"), cell: (search) => (search.unseen ? <Pill tone="warn">{t("jobSearchesMenu.unseen")}</Pill> : null) },
  ];
  return (
    <Card title={t("jobSearchesMenu.title")} headingId={CARD_TITLE_ID} actions={unseen > 0 ? <Pill tone="warn">{t("applicationsMenu.toHandle", { count: unseen })}</Pill> : undefined}>
      {groups.length === 0 ? (
        <EmptyState
          title={t("jobSearchesPage.noActiveProfileTitle")}
          actions={
            <Link className={buttonClass({ variant: "primary" })} href={routes.newProfile}>
              {t("jobSearchesPage.createProfile")}
            </Link>
          }
          help={<EmptyStateHelp of="profiles" />}
        >
          {t("jobSearchesPage.noActiveProfile")}
        </EmptyState>
      ) : (
        groups.map(({ profile, searches }) => (
          <section key={profile.id} className="menu-card-group" aria-labelledby={`job-searches-of-${profile.id}`}>
            <h3 id={`job-searches-of-${profile.id}`}>
              <Link href={routes.profile(profile.id)}>{profile.name}</Link>
            </h3>
            {searches.length === 0 ? (
              <p>{t("jobSearchesMenu.none")}</p>
            ) : (
              <Table label={t("jobSearchesMenu.tableLabel", { profile: profile.name })} columns={columns} rows={searches} rowKey={(search) => search.id} data-row-links="" />
            )}
          </section>
        ))
      )}
      {groups.length > 0 ? (
        <p className="menu-card-foot">
          <Link href={routes.receivedByEmail}>{t("jobSearchesMenu.receivedByEmail")}</Link>
        </p>
      ) : null}
    </Card>
  );
}

/**
 * « Reçues par email » (#447) in the Work Pane: each active Profile's Job Offers from Email intake, then what Email intake
 * did for the Candidate as a whole (« Non classées », the emails ignored this week, « Filtre trop large »).
 */
async function ReceivedByEmailPane({ candidateId, profiles, t, locale }: { candidateId: string; profiles: Profile[]; t: T; locale: string }) {
  const { broadFilterThreshold } = emailIntakeLimits(getPlatformSettingsResolver().current());
  const [overview, address, senders] = await Promise.all([
    getReceivedOffers().overview(candidateId, { broadFilterThreshold }),
    getEmailIntake().forwardingAddress(candidateId),
    getCandidateSenders().list(candidateId),
  ]);
  // The domains the Candidate added (#450): their ignored emails no longer offer « C'est une alerte d'offres ».
  const ownSenders = senders.own.filter((sender) => sender.match === "domain").map((sender) => sender.value);
  return (
    <InWorkPane kind={RECEIVED} title={t("receivedByEmail.title")} href={routes.receivedByEmail} back={routes.jobSearches()}>
      {profiles.map((profile) => (
        <section key={profile.id} className="menu-card-group" aria-labelledby={`received-of-${profile.id}`}>
          <h3 id={`received-of-${profile.id}`}>{profile.name}</h3>
          <ReceivedByEmail profile={profile} group={overview.byProfile[profile.id]} t={t} locale={locale} headingLevel={4} />
        </section>
      ))}
      <EmailIntakeStanding overview={overview} switchedOn={address !== null} ownSenders={ownSenders} t={t} locale={locale} headingLevel={3} />
    </InWorkPane>
  );
}
