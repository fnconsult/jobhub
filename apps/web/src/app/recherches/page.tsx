import type { Activity } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { loadAiActivity } from "@/ai-activity/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { EmailIntakeStanding, ReceivedByEmail } from "@/components/ReceivedByEmail";
import { ActivityGlyph } from "@/components/ActivityGlyph";
import { CoachInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartAllJobSearchesButton, StartJobSearchButton } from "@/components/JobSearchControls";
import { JobSearchTabs } from "@/components/JobSearchTabs";
import { SearchCriteriaDialog } from "@/components/SearchCriteriaDialog";
import { searchCriteriaInWords } from "@/components/job-search-words";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { EmptyState } from "@/design/EmptyState";
import { Field, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { emailIntakeLimits } from "@/email-intake/domain";
import type { ReceivedOffersOverview } from "@/email-intake/received-offers";
import { getCandidateSenders, getEmailIntake, getReceivedOffers } from "@/email-intake/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import type { JobSearch } from "@/job-searches";
import { getJobSearches } from "@/job-searches/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getProfiles } from "@/profiles/server";
import { readIndustryReference } from "@/reference-data/server";
import { routes } from "@/routes";
import "./recherches.css";

/** The address's values: every active Profile at once, and their results in swimlanes (tabs by default). */
const ALL = "tous";
const LANES = "couloirs";
/** `aria-current` of the link to the view being shown. */
const CURRENT = "page";
/** The Activity of a Job Search under way: its glyph, the magnifier sweeping. */
const SEARCHING: Activity = "search";

type T = Awaited<ReturnType<typeof getServerT>>;
type Profile = { id: string; name: string };
/** Where a Profile's Job Searches stand: the one still searching, and the latest done one. */
type Standing = { profile: Profile; searching: JobSearch | null; latest: JobSearch | null };

/** What Email intake gave the Candidate (#447), and whether it is on for them: the « Reçues par email » sections. */
async function emailIntakeOf(candidateId: string): Promise<{ overview: ReceivedOffersOverview; switchedOn: boolean; ownSenders: string[] }> {
  const { broadFilterThreshold } = emailIntakeLimits(getPlatformSettingsResolver().current());
  const [overview, address, senders] = await Promise.all([
    getReceivedOffers().overview(candidateId, { broadFilterThreshold }),
    getEmailIntake().forwardingAddress(candidateId),
    getCandidateSenders().list(candidateId),
  ]);
  // The domains the Candidate added (#450): their ignored emails no longer offer « C'est une alerte d'offres ».
  const ownSenders = senders.own.filter((sender) => sender.match === "domain").map((sender) => sender.value);
  return { overview, switchedOn: address !== null, ownSenders };
}

/** The Job Searches the page shows, for AI Activity: each Profile's search under way and its latest done one. */
const searchesShown = (standings: readonly Standing[]): JobSearch[] =>
  standings.flatMap(({ searching, latest }) => [searching, latest].filter((search): search is JobSearch => search !== null));

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("sidebar.jobSearches")} · ${t("app.name")}` };
}

/**
 * Recherches d'offres (ADR-0024, ADR-0025): Job Searches for one active Profile
 * (`?profil=<id>`, by default the first) or for all of them at once (`?profil=tous`),
 * the choice kept in the address. For one Profile: its Search Criteria in words (a button
 * opening them in a dialog, #237), the "Chercher des offres" button, a Job Search still searching
 * (the page refreshes itself until it ends) and the results of its latest done Job Search.
 * For all: one button starting one Job Search per active Profile, and each Profile's latest
 * results, in tabs or, with `?vue=couloirs`, in swimlanes scrolled sideways.
 * Below them, « Reçues par email » (#447): each Profile's Job Offers from Email intake, newest first, with how many
 * arrived this week, then « Non classées », the emails ignored this week and « Filtre trop large » when it is.
 * Drawn in the Design System's Confort Density (#467): the Profile and its Search Criteria on a card, a search under
 * way as its live Activity step, the Job Offers as cards, and empty states with their link to the help.
 */
export default async function JobSearchesPage({ searchParams }: { searchParams: Promise<{ profil?: string; vue?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const [t, locale, profiles, params, industries] = await Promise.all([getServerT(), getRequestLocale(), getProfiles().list(candidate.id), searchParams, readIndustryReference()]);
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const first = active[0];
  if (!first) {
    return (
      <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobSearches")}>
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
      </CandidateLayout>
    );
  }
  const all = params.profil === ALL;
  const chosen = all ? undefined : active.find((profile) => profile.id === params.profil);
  // No Profile named, or one archived or not theirs: the first active Profile's address.
  if (!all && !chosen) redirect(routes.jobSearches(first.id));
  const lanes = all && params.vue === LANES;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
  const standingOf = async (profile: Profile): Promise<Standing> => {
    const [searching, latest] = await Promise.all([getJobSearches().searching(candidate.id, profile.id), getJobSearches().latest(candidate.id, profile.id)]);
    return { profile, searching, latest };
  };

  if (chosen) {
    const [standing, full, emailIntake] = await Promise.all([standingOf(chosen), getProfiles().get(candidate.id, chosen.id), emailIntakeOf(candidate.id)]);
    if (!full) notFound();
    const { searching, latest } = standing;
    const aiActivity = await loadAiActivity.jobSearches(searchesShown([standing]));
    const inView = latest
      ? ({ kind: "job_search", id: latest.id, name: chosen.name, profileId: chosen.id } as const)
      : ({ kind: "profile", id: chosen.id, name: chosen.name } as const);
    return (
      <CandidateLayout candidateId={candidate.id} currentProfileId={chosen.id} title={t("sidebar.jobSearches")} aiActivity={aiActivity}>
        <CoachInView {...inView} />
        <header className="job-searches-head">
          <p className="job-searches-head__intro">{t("jobSearchesPage.intro")}</p>
          <ProfileChooser profiles={active} chosen={chosen.id} lanes={false} t={t} />
        </header>
        <Card>
          <div className="job-searches-criteria">
            <dl className="job-searches-criteria__list">
              <div>
                <dt>{t("jobSearchesPage.profileLabel")}</dt>
                <dd>
                  <Link href={routes.profile(chosen.id)}>{chosen.name}</Link>
                </dd>
              </div>
              <div>
                <dt>{t("jobSearch.criteria")}</dt>
                <dd>
                  <span>{searchCriteriaInWords(full.searchCriteria, t, locale, industries)}</span>
                  <SearchCriteriaDialog profileId={chosen.id} profileName={chosen.name} searchCriteria={full.searchCriteria} />
                </dd>
              </div>
            </dl>
            {searching ? null : <StartJobSearchButton profileId={chosen.id} icon={<Icons.jobSearches />} />}
          </div>
        </Card>
        {searching ? <RefreshWhileSearching /> : null}
        <ProfileStanding standing={standing} t={t} locale={locale} date={date} />
        <ReceivedByEmail profile={chosen} group={emailIntake.overview.byProfile[chosen.id]} t={t} locale={locale} headingLevel={2} />
        <EmailIntakeStanding overview={emailIntake.overview} switchedOn={emailIntake.switchedOn} ownSenders={emailIntake.ownSenders} t={t} locale={locale} headingLevel={2} />
      </CandidateLayout>
    );
  }

  const [standings, emailIntake] = await Promise.all([Promise.all(active.map(standingOf)), emailIntakeOf(candidate.id)]);
  const aiActivity = await loadAiActivity.jobSearches(searchesShown(standings));
  return (
    <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobSearches")} wide={lanes} aiActivity={aiActivity}>
      <header className="job-searches-head">
        <p className="job-searches-head__intro">{t("jobSearchesPage.intro")}</p>
        <ProfileChooser profiles={active} chosen={ALL} lanes={lanes} t={t} />
      </header>
      <Card>
        <div className="job-searches-criteria">
          <p className="job-searches-criteria__hint">{t("jobSearchesPage.startAllHint")}</p>
          <StartAllJobSearchesButton profiles={active} icon={<Icons.jobSearches />} />
        </div>
      </Card>
      {standings.some((standing) => standing.searching) ? <RefreshWhileSearching /> : null}
      <section className="job-searches-groups" aria-labelledby="job-searches-groups-title">
        <div className="job-searches-section-head">
          <h2 id="job-searches-groups-title">{t("jobSearchesPage.groupsLabel")}</h2>
          <nav className="job-searches-views" aria-label={t("jobSearchesPage.viewsLabel")}>
            <Link className={buttonClass({ size: "sm", variant: lanes ? "quiet" : "secondary" })} href={routes.allJobSearches()} aria-current={lanes ? undefined : CURRENT}>
              {t("jobSearchesPage.tabsView")}
            </Link>
            <Link className={buttonClass({ size: "sm", variant: lanes ? "secondary" : "quiet" })} href={routes.allJobSearches(true)} aria-current={lanes ? CURRENT : undefined}>
              {t("jobSearchesPage.lanesView")}
            </Link>
          </nav>
        </div>
        {lanes ? (
          standings.map((standing) => (
            <ProfileGroup key={standing.profile.id} standing={standing} received={emailIntake.overview.byProfile[standing.profile.id]} lanes t={t} locale={locale} date={date} />
          ))
        ) : (
          <JobSearchTabs
            label={t("jobSearchesPage.groupsLabel")}
            tabs={standings.map((standing) => ({
              value: standing.profile.id,
              label: standing.profile.name,
              panel: <ProfileGroup standing={standing} received={emailIntake.overview.byProfile[standing.profile.id]} lanes={false} t={t} locale={locale} date={date} />,
            }))}
          />
        )}
      </section>
      <EmailIntakeStanding overview={emailIntake.overview} switchedOn={emailIntake.switchedOn} ownSenders={emailIntake.ownSenders} t={t} locale={locale} headingLevel={2} />
    </CandidateLayout>
  );
}

/**
 * The Profile chooser: a plain form sent by its button, so it works without scripts and the
 * choice lands in the address. In the swimlanes, choosing all Profiles again keeps them.
 */
function ProfileChooser({ profiles, chosen, lanes, t }: { profiles: Profile[]; chosen: string; lanes: boolean; t: T }) {
  return (
    <form className="job-searches-chooser" method="get" action={routes.jobSearches()} aria-label={t("jobSearchesPage.chooserLabel")}>
      <Field label={t("jobSearchesPage.profileLabel")}>
        <Select name="profil" defaultValue={chosen}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
          <option value={ALL}>{t("jobSearchesPage.allProfiles")}</option>
        </Select>
      </Field>
      {/* After the Profile, so the address reads ?profil=tous&vue=couloirs. */}
      {lanes ? <input type="hidden" name="vue" value={LANES} /> : null}
      <button className={buttonClass()} type="submit">
        {t("jobSearchesPage.show")}
      </button>
    </form>
  );
}

/**
 * A Job Search under way, as its live Activity step (#467): the magnifier sweeping, in words beside it, and a link
 * to follow it. Said in the live region around it.
 */
function SearchRunning({ search, t }: { search: JobSearch; t: T }) {
  return (
    <p className="job-searches-step">
      <ActivityGlyph activity={SEARCHING} live />
      <span>{t("jobSearchesPage.searching")}</span>
      <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.jobSearch(search.id)}>
        {t("jobSearchesPage.seeRunning")}
      </Link>
    </p>
  );
}

/**
 * Where one Profile's Job Searches stand: one still searching (said in a live region, with a
 * link to follow it), then the latest done one's Job Offers, best Match Score first, with a
 * link to its page; or that there is none yet.
 */
function ProfileStanding({ standing: { profile, searching, latest }, t, locale, date }: { standing: Standing; t: T; locale: string; date: Intl.DateTimeFormat }) {
  const titleId = `job-searches-latest-${profile.id}`;
  return (
    <>
      <div className="job-searches-status" role="status">
        {searching ? <SearchRunning search={searching} t={t} /> : null}
      </div>
      {latest ? (
        <section className="job-searches-results" aria-labelledby={titleId}>
          <div className="job-searches-section-head">
            <h2 id={titleId}>{t("jobSearchesPage.latestTitle")}</h2>
            <p className="job-searches-section-head__meta">
              {t("jobSearchesPage.latestOn", { date: date.format(latest.startedAt) })}{" "}
              <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.jobSearch(latest.id)}>
                {t("jobSearchesPage.seeJobSearch")}
              </Link>
            </p>
          </div>
          {latest.results.length > 0 ? (
            <>
              <p className="job-searches-results__intro">{t("jobSearch.resultsIntro", { count: latest.results.length })}</p>
              <JobOfferResults
                results={latest.results}
                profileId={profile.id}
                t={t}
                locale={locale}
                headingLevel={3}
                label={t("jobSearchesPage.groupTitle", { profile: profile.name })}
              />
            </>
          ) : (
            <Note>{t("jobSearch.noResults")}</Note>
          )}
        </section>
      ) : searching ? null : (
        <EmptyState title={t("jobSearchesPage.neverTitle")} help={<EmptyStateHelp of="jobSearches" />}>
          {t("jobSearchesPage.never")}
        </EmptyState>
      )}
    </>
  );
}

/**
 * One Profile's group in the all-Profiles view: its name, where its Job Searches stand
 * and a link to its Job Search's page (or to its own view, before any). In a swimlane
 * its Job Offers sit side by side in a strip that scrolls sideways (alone, never the page),
 * reachable from the keyboard. Then its « Reçues par email » (#447).
 */
function ProfileGroup({
  standing,
  received,
  lanes,
  t,
  locale,
  date,
}: {
  standing: Standing;
  received: ReceivedOffersOverview["byProfile"][string] | undefined;
  lanes: boolean;
  t: T;
  locale: string;
  date: Intl.DateTimeFormat;
}) {
  const { profile, searching, latest } = standing;
  const titleId = `job-searches-group-${profile.id}`;
  const shown = latest ?? searching;
  const results = latest ? (
    <JobOfferResults results={latest.results} profileId={profile.id} t={t} locale={locale} headingLevel={4} label={t("jobSearchesPage.groupTitle", { profile: profile.name })} />
  ) : null;
  return (
    <section className={lanes ? "job-searches-group lane" : "job-searches-group"} aria-labelledby={titleId}>
      <div className="job-searches-section-head">
        <h3 id={titleId}>{t("jobSearchesPage.groupTitle", { profile: profile.name })}</h3>
        {shown ? (
          <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.jobSearch(shown.id)}>
            {t("jobSearchesPage.seeJobSearch")}
          </Link>
        ) : (
          <Link className={buttonClass({ variant: "quiet", size: "sm" })} href={routes.jobSearches(profile.id)}>
            {t("jobSearchesPage.searchThisProfile")}
          </Link>
        )}
      </div>
      <div className="job-searches-status" role="status">
        {searching ? <SearchRunning search={searching} t={t} /> : null}
      </div>
      {latest ? (
        <>
          <p className="job-searches-section-head__meta">{t("jobSearchesPage.latestOn", { date: date.format(latest.startedAt) })}</p>
          {latest.results.length === 0 ? (
            <Note>{t("jobSearch.noResults")}</Note>
          ) : lanes ? (
            <div className="lane-track" role="region" tabIndex={0} aria-label={t("jobSearchesPage.laneLabel", { profile: profile.name })}>
              {results}
            </div>
          ) : (
            results
          )}
        </>
      ) : searching ? null : (
        <Note>
          {t("jobSearchesPage.never")} <EmptyStateHelp of="jobSearches" />
        </Note>
      )}
      <ReceivedByEmail profile={profile} group={received} t={t} locale={locale} headingLevel={4} />
    </section>
  );
}
