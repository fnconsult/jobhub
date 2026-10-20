import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { CandidateLayout } from "@/components/CandidateLayout";
import { CoachInView } from "@/components/CoachPanel";
import { Icons } from "@/components/icons";
import { JobOfferResults } from "@/components/JobOfferResults";
import { RefreshWhileSearching, StartAllJobSearchesButton, StartJobSearchButton } from "@/components/JobSearchControls";
import { JobSearchTabs } from "@/components/JobSearchTabs";
import { SearchCriteriaDialog } from "@/components/SearchCriteriaDialog";
import { searchCriteriaInWords } from "@/components/job-search-words";
import { getRequestLocale, getServerT } from "@/i18n/server";
import type { JobSearch } from "@/job-searches";
import { getJobSearches } from "@/job-searches/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

/** The address's values: every active Profile at once, and their results in swimlanes (tabs by default). */
const ALL = "tous";
const LANES = "couloirs";
/** `aria-current` of the link to the view being shown. */
const CURRENT = "page";

type T = Awaited<ReturnType<typeof getServerT>>;
type Profile = { id: string; name: string };
/** Where a Profile's Job Searches stand: the one still searching, and the latest done one. */
type Standing = { profile: Profile; searching: JobSearch | null; latest: JobSearch | null };

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
 */
export default async function JobSearchesPage({ searchParams }: { searchParams: Promise<{ profil?: string; vue?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const [t, locale, profiles, params] = await Promise.all([getServerT(), getRequestLocale(), getProfiles().list(candidate.id), searchParams]);
  const active = profiles.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  const first = active[0];
  if (!first) {
    return (
      <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobSearches")}>
        <p className="notice">
          {t("jobSearchesPage.noActiveProfile")} <Link className="props-action" href={routes.newProfile}>
            {t("jobSearchesPage.createProfile")}
          </Link>
        </p>
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
    const [standing, full] = await Promise.all([standingOf(chosen), getProfiles().get(candidate.id, chosen.id)]);
    if (!full) notFound();
    const { searching, latest } = standing;
    const inView = latest
      ? ({ kind: "job_search", id: latest.id, name: chosen.name, profileId: chosen.id } as const)
      : ({ kind: "profile", id: chosen.id, name: chosen.name } as const);
    return (
      <CandidateLayout candidateId={candidate.id} currentProfileId={chosen.id} title={t("sidebar.jobSearches")}>
        <CoachInView {...inView} />
        <header className="page-head job-searches-head">
          <p className="lead">{t("jobSearchesPage.intro")}</p>
          <ProfileChooser profiles={active} chosen={chosen.id} lanes={false} t={t} />
          <dl className="props">
            <dt>{t("jobSearchesPage.profileLabel")}</dt>
            <dd>
              <Link className="props-action" href={routes.profile(chosen.id)}>
                {chosen.name}
              </Link>
            </dd>
            <dt>{t("jobSearch.criteria")}</dt>
            <dd>
              <span>{searchCriteriaInWords(full.searchCriteria, t, locale)}</span>
              <SearchCriteriaDialog profileId={chosen.id} profileName={chosen.name} searchCriteria={full.searchCriteria} />
            </dd>
          </dl>
          {searching ? null : (
            <div className="btn-row">
              <StartJobSearchButton profileId={chosen.id} icon={<Icons.jobSearches />} />
            </div>
          )}
        </header>
        {searching ? <RefreshWhileSearching /> : null}
        <ProfileStanding standing={standing} t={t} locale={locale} date={date} />
      </CandidateLayout>
    );
  }

  const standings = await Promise.all(active.map(standingOf));
  return (
    <CandidateLayout candidateId={candidate.id} title={t("sidebar.jobSearches")} wide={lanes}>
      <header className="page-head job-searches-head">
        <p className="lead">{t("jobSearchesPage.intro")}</p>
        <ProfileChooser profiles={active} chosen={ALL} lanes={lanes} t={t} />
        <p className="hint">{t("jobSearchesPage.startAllHint")}</p>
        <div className="btn-row">
          <StartAllJobSearchesButton profiles={active} icon={<Icons.jobSearches />} />
        </div>
      </header>
      {standings.some((standing) => standing.searching) ? <RefreshWhileSearching /> : null}
      <section className="section job-searches-groups" aria-labelledby="job-searches-groups-title">
        <div className="section-head">
          <h2 id="job-searches-groups-title">{t("jobSearchesPage.groupsLabel")}</h2>
          <nav className="actions list-views" aria-label={t("jobSearchesPage.viewsLabel")}>
            <Link className="button" href={routes.allJobSearches()} aria-current={lanes ? undefined : CURRENT}>
              {t("jobSearchesPage.tabsView")}
            </Link>
            <Link className="button" href={routes.allJobSearches(true)} aria-current={lanes ? CURRENT : undefined}>
              {t("jobSearchesPage.lanesView")}
            </Link>
          </nav>
        </div>
        {lanes ? (
          standings.map((standing) => <ProfileGroup key={standing.profile.id} standing={standing} lanes t={t} locale={locale} date={date} />)
        ) : (
          <JobSearchTabs
            label={t("jobSearchesPage.groupsLabel")}
            tabs={standings.map((standing) => ({
              value: standing.profile.id,
              label: standing.profile.name,
              panel: <ProfileGroup standing={standing} lanes={false} t={t} locale={locale} date={date} />,
            }))}
          />
        )}
      </section>
    </CandidateLayout>
  );
}

/**
 * The Profile chooser: a plain form sent by its button, so it works without scripts and the
 * choice lands in the address. In the swimlanes, choosing all Profiles again keeps them.
 */
function ProfileChooser({ profiles, chosen, lanes, t }: { profiles: Profile[]; chosen: string; lanes: boolean; t: T }) {
  return (
    <form className="list-filters job-searches-chooser" method="get" action={routes.jobSearches()} aria-label={t("jobSearchesPage.chooserLabel")}>
      <div className="field">
        <label htmlFor="job-searches-profile">{t("jobSearchesPage.profileLabel")}</label>
        <select id="job-searches-profile" name="profil" className="input" defaultValue={chosen}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
          <option value={ALL}>{t("jobSearchesPage.allProfiles")}</option>
        </select>
      </div>
      {/* After the Profile, so the address reads ?profil=tous&vue=couloirs. */}
      {lanes ? <input type="hidden" name="vue" value={LANES} /> : null}
      <button className="button" type="submit">
        {t("jobSearchesPage.show")}
      </button>
    </form>
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
      <div className="page-head-status" role="status">
        {searching ? (
          <p className="notice">
            {t("jobSearchesPage.searching")} <Link className="props-action" href={routes.jobSearch(searching.id)}>
              {t("jobSearchesPage.seeRunning")}
            </Link>
          </p>
        ) : null}
      </div>
      {latest ? (
        <section className="section" aria-labelledby={titleId}>
          <div className="section-head">
            <h2 id={titleId}>{t("jobSearchesPage.latestTitle")}</h2>
            <p className="hint">
              {t("jobSearchesPage.latestOn", { date: date.format(latest.startedAt) })}{" "}
              <Link className="props-action" href={routes.jobSearch(latest.id)}>
                {t("jobSearchesPage.seeJobSearch")}
              </Link>
            </p>
          </div>
          {latest.results.length > 0 ? (
            <>
              <p>{t("jobSearch.resultsIntro", { count: latest.results.length })}</p>
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
            <p className="notice">{t("jobSearch.noResults")}</p>
          )}
        </section>
      ) : searching ? null : (
        <p className="notice">{t("jobSearchesPage.never")}</p>
      )}
    </>
  );
}

/**
 * One Profile's group in the all-Profiles view: its name, where its Job Searches stand
 * and a link to its Job Search's page (or to its own view, before any). In a swimlane
 * its Job Offers sit side by side in a strip that scrolls sideways (alone, never the page),
 * reachable from the keyboard.
 */
function ProfileGroup({ standing, lanes, t, locale, date }: { standing: Standing; lanes: boolean; t: T; locale: string; date: Intl.DateTimeFormat }) {
  const { profile, searching, latest } = standing;
  const titleId = `job-searches-group-${profile.id}`;
  const shown = latest ?? searching;
  const results = latest ? (
    <JobOfferResults results={latest.results} profileId={profile.id} t={t} locale={locale} headingLevel={4} label={t("jobSearchesPage.groupTitle", { profile: profile.name })} />
  ) : null;
  return (
    <section className={lanes ? "section lane" : "section"} aria-labelledby={titleId}>
      <div className="section-head">
        <h3 id={titleId}>{t("jobSearchesPage.groupTitle", { profile: profile.name })}</h3>
        {shown ? (
          <Link className="props-action" href={routes.jobSearch(shown.id)}>
            {t("jobSearchesPage.seeJobSearch")}
          </Link>
        ) : (
          <Link className="props-action" href={routes.jobSearches(profile.id)}>
            {t("jobSearchesPage.searchThisProfile")}
          </Link>
        )}
      </div>
      <div className="page-head-status" role="status">
        {searching ? (
          <p className="notice">
            {t("jobSearchesPage.searching")} <Link className="props-action" href={routes.jobSearch(searching.id)}>
              {t("jobSearchesPage.seeRunning")}
            </Link>
          </p>
        ) : null}
      </div>
      {latest ? (
        <>
          <p className="hint">{t("jobSearchesPage.latestOn", { date: date.format(latest.startedAt) })}</p>
          {latest.results.length === 0 ? (
            <p className="notice">{t("jobSearch.noResults")}</p>
          ) : lanes ? (
            <div className="lane-track" role="region" tabIndex={0} aria-label={t("jobSearchesPage.laneLabel", { profile: profile.name })}>
              {results}
            </div>
          ) : (
            results
          )}
        </>
      ) : searching ? null : (
        <p className="notice">{t("jobSearchesPage.never")}</p>
      )}
    </section>
  );
}
