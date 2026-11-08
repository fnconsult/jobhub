import Link from "next/link";
import { cache } from "react";
import { offerBoxResponse } from "@/candidate-reads";
import { getCoachConversations } from "@/coach-conversations/server";
import { CoachConversationPage } from "@/components/CoachConversationPage";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { JobOfferInPane } from "@/components/JobOfferInPane";
import { RefreshWhileSearching } from "@/components/JobSearchControls";
import { JobSearchesMenuSuggestions } from "@/components/JobSearchesMenuSuggestions";
import { OfferBox } from "@/components/OfferBox";
import { EmailIntakeStanding, ReceivedByEmail } from "@/components/ReceivedByEmail";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { buttonClass } from "@/design/button-class";
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
import type { OfferBoxContents } from "@/offer-box";
import { getOfferBox } from "@/offer-box/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { objectDay } from "@/sidebar-menus";
import "./MenuCards.css";

type T = Awaited<ReturnType<typeof getServerT>>;
type Profile = { id: string; name: string };

/** Recherches d'offres' Subject: the menu's one conversation per Candidate (ADR-0070). */
const SUBJECT = { kind: "menu", id: "jobSearches" } as const;

/** « Recherches par Profil » and « Reçues par email » in the Work Pane: Sections of Recherches d'offres. */
const SECTION: AddressedKind = "section";
/** An Offer box entry's Job Offer in the Work Pane (« Lire l'offre »): one of its Results. */
const RESULT: AddressedKind = "result";

/** What the address opens in the Work Pane beside the Offer box: « Recherches par Profil », « Reçues par email » or a Job Offer. */
export type JobSearchesPane = { kind: "byProfile" } | { kind: "received" } | { kind: "offer"; jobOfferId: string } | null;

/**
 * The Candidate's Offer box, read once per request: the page's title reads its count for the filter icon in the Top Bar
 * (#898), and the page lays it out.
 */
export const readOfferBox = cache((candidateId: string) => getOfferBox().read(candidateId));

/** A Job Search's outcome, tinted; its words carry the meaning. */
const STATUS_TONES: Record<JobSearchStatus, Tone> = { searching: "accent", done: "success", failed: "danger", stopped: "neutral" };

/**
 * Recherches d'offres (ADR-0090, amending ADR-0070 for this menu): the Offer box (« Offres à traiter ») is the page, its
 * header, day and tier staying in view while it scrolls; the menu's conversation, one per Candidate, follows it, its box
 * at the foot, « Lancer une recherche » a suggestion above it. « Recherches par Profil » (the Job Searches by active
 * Profile: when, where each stands, the Job Offers found, those still unseen), « Reçues par email » (#447) and an entry's
 * Job Offer (« Lire l'offre ») open in the Work Pane (`pane`), each at its own address. While a Job Search is under way,
 * the page refreshes itself until it ends.
 */
export async function JobSearchesMenuPage({ candidateId, pane }: { candidateId: string; pane: JobSearchesPane }) {
  const [t, locale, profiles, searches, subject, box] = await Promise.all([
    getServerT(),
    getRequestLocale(),
    getProfiles().list(candidateId),
    getJobSearches().list(candidateId),
    getCoachConversations().ofSubject(candidateId, SUBJECT),
    readOfferBox(candidateId),
  ]);
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const conversationId = subject.ok ? (subject.conversation?.id ?? null) : null;
  return (
    <>
      <CoachConversationPage
        key={conversationId ?? "new"}
        conversationId={conversationId}
        subject={SUBJECT}
        introduction={<p>{t("jobSearchesMenu.introduction")}</p>}
        lead={<OfferBox box={offerBoxResponse(box)} />}
        suggestions={<JobSearchesMenuSuggestions profiles={active} />}
      />
      {searches.some((search) => search.status === "searching") ? <RefreshWhileSearching /> : null}
      {pane?.kind === "byProfile" ? (
        <InWorkPane kind={SECTION} title={t("offerBox.byProfile")} href={routes.jobSearchesByProfile} back={routes.jobSearches()}>
          <JobSearchesByProfile groups={jobSearchesMenu({ profiles: active, searches, dateLabel: objectDay(locale) }).groups} locale={locale} t={t} />
        </InWorkPane>
      ) : null}
      {pane?.kind === "received" ? <ReceivedByEmailPane candidateId={candidateId} profiles={active} t={t} locale={locale} /> : null}
      {pane?.kind === "offer" ? <OfferBoxOfferPane box={box} jobOfferId={pane.jobOfferId} t={t} locale={locale} /> : null}
    </>
  );
}

/** An Offer box entry's Job Offer in the Work Pane: its facts, its Match Score against its Profile, saving it, its text. */
function OfferBoxOfferPane({ box, jobOfferId, t, locale }: { box: OfferBoxContents; jobOfferId: string; t: T; locale: string }) {
  const entry = box.entries.find((one) => one.jobOffer.id === jobOfferId);
  if (!entry?.scoredWith || !entry.matchScore) return null;
  return (
    <InWorkPane kind={RESULT} title={entry.jobOffer.title} href={routes.offerBoxOffer(jobOfferId)} back={routes.jobSearches()}>
      <JobOfferInPane result={{ jobOffer: entry.jobOffer, matchScore: entry.matchScore, applicationId: entry.applicationId }} profile={entry.scoredWith} t={t} locale={locale} />
    </InWorkPane>
  );
}

/** « Recherches par Profil » (the menu's card before ADR-0090): the Job Searches by active Profile, each line to its Job Search. */
function JobSearchesByProfile({ groups, locale, t }: { groups: JobSearchesMenuGroup[]; locale: string; t: T }) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
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
    <>
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
    </>
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
    <InWorkPane kind={SECTION} title={t("receivedByEmail.title")} href={routes.receivedByEmail} back={routes.jobSearches()}>
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
