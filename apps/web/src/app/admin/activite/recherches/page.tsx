import { SKIP_REASONS, toolById, type DiscoveryMetrics, type FranceTravailMetrics } from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { BackOfficeResource, Permission } from "@/admin/access";
import type { ActivityTabId } from "@/admin/activity";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { AddressDrawer } from "@/design/AddressDrawer";
import { buttonClass } from "@/design/button-class";
import { Field, Select } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table } from "@/design/Table";
import { PageIntro } from "@/components/PageIntro";
import {
  DISCOVERY_RUN_PERIODS,
  DISCOVERY_RUN_TRIGGERS,
  discoveryRunFilter,
  LIST_LIMIT,
  QUERY_RETENTION_DAYS,
  RETENTION_MONTHS,
  runAiCalls,
  type DiscoveryRun,
  type DiscoveryRunFilter,
} from "@/discovery-runs";
import { getDiscoveryRuns } from "@/discovery-runs/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { parametresHref } from "@/platform-settings/parametres";
import { routes } from "@/routes";
import { ActivityTabs } from "../ActivityTabs";
import "../activite.css";

type Search = Record<string, string | string[] | undefined>;

/** This tab of Activité (#404). */
const TAB: ActivityTabId = "discoveryRuns";
/** The tables' hooks for the tests. */
const TEST_IDS = { runs: "discovery-runs", searches: "run-searches" } as const;
/** The run whose panel is open, as its row says it (`aria-current`). */
const OPEN_ROW = "true";
const READ: Permission = "read";
const SETTINGS: BackOfficeResource = "platformSettings";
const AI_CALLS: BackOfficeResource = "aiMessages";
const JOB_SEARCHES: BackOfficeResource = "jobSearches";
/** Where the web search is set: Paramètres' Recherche web tab. */
const WEB_SEARCH_SETTINGS = parametresHref("web_search");
type T = Awaited<ReturnType<typeof getServerT>>;

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("discoveryRuns");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.discoveryRuns")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** A Search provider by its Tool's name; an id the catalog no longer has, as recorded. */
const providerName = (id: string) => toolById(id)?.name ?? id;

/** The list's address with `filter`, opening `run`'s panel (or none). */
const hrefOf = (filter: DiscoveryRunFilter, run?: string) => routes.adminDiscoveryRuns({ trigger: filter.trigger, period: filter.period, fallback: filter.fallback, run });

/**
 * Activité › Recherches (#404, ADR-0042): every run of Job discovery, a Job Search's or a Job Digest top-up's, newest
 * first, filtered by trigger, period and fallback; a run's panel (`run`) shows its Discovery metrics, each search with
 * its query texts while they are kept, its Skip reasons, and for super-admins, links to its Appels IA and its Job Search
 * (that opening audited). Super-admins, Technique and Support read it; no Candidate is named.
 */
export default async function DiscoveryRunsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { access } = await requireBackOffice("discoveryRuns");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const search = await searchParams;
  const filter = discoveryRunFilter({ trigger: search.declencheur, period: search.periode, fallback: search.secours });
  const runId = typeof search.run === "string" ? search.run : undefined;
  const [runs, opened] = await Promise.all([getDiscoveryRuns().list(filter), runId ? getDiscoveryRuns().get(runId) : Promise.resolve(null)]);
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
  const seconds = new Intl.NumberFormat(locale, { style: "unit", unit: "second", maximumFractionDigits: 0 });
  const eur = new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const readsSettings = access.can(SETTINGS, READ);
  // A run's AI calls and its Job Search are the Candidate's own data: super-admins only.
  const readsAiCalls = access.can(AI_CALLS, READ);
  const opensJobSearches = access.can(JOB_SEARCHES, READ);

  return (
    <BackOfficeLayout access={access} title={t("admin.activity.title")}>
      <div className="activite">
        <ActivityTabs access={access} shown={TAB} />
        <PageIntro t={t} page={TAB} subject={t("admin.activity.tabs.discoveryRuns")} values={{ days: String(QUERY_RETENTION_DAYS), months: String(RETENTION_MONTHS) }} />
        {readsSettings ? (
          <p>
            <Link prefetch={false} href={WEB_SEARCH_SETTINGS}>
              {t("admin.discoveryRuns.settingsLink")}
            </Link>
          </p>
        ) : null}

        <form method="get" action={routes.adminDiscoveryRuns()} className="activity-filter" aria-label={t("admin.discoveryRuns.filter")}>
          <Field label={t("admin.discoveryRuns.trigger")}>
            <Select name="declencheur" defaultValue={filter.trigger ?? ""}>
              <option value="">{t("admin.discoveryRuns.anyTrigger")}</option>
              {DISCOVERY_RUN_TRIGGERS.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {t(`admin.discoveryRuns.triggers.${trigger}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("admin.discoveryRuns.period")}>
            <Select name="periode" defaultValue={filter.period}>
              {DISCOVERY_RUN_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {t(`admin.discoveryRuns.periods.${period}`)}
                </option>
              ))}
            </Select>
          </Field>
          <label className="choice">
            <input name="secours" type="checkbox" value="1" defaultChecked={filter.fallback} />
            {t("admin.discoveryRuns.fallbackOnly")}
          </label>
          <div className="activity-filter-actions">
            <button type="submit" className={buttonClass()}>
              {t("admin.discoveryRuns.apply")}
            </button>
          </div>
        </form>

        {runs.length === 0 ? (
          <p>{t("admin.discoveryRuns.none")}</p>
        ) : (
          <>
            <p>{t("admin.discoveryRuns.count", { count: runs.length })}</p>
            {runs.length >= LIST_LIMIT ? <p>{t("admin.discoveryRuns.limit", { count: String(LIST_LIMIT) })}</p> : null}
            <Table
              label={t("admin.discoveryRuns.caption")}
              data-testid={TEST_IDS.runs}
              columns={[
                { header: t("admin.discoveryRuns.at"), rowHeader: true, cell: (run) => <time dateTime={run.startedAt.toISOString()}>{at.format(run.startedAt)}</time> },
                { header: t("admin.discoveryRuns.trigger"), cell: (run) => t(`admin.discoveryRuns.triggers.${run.trigger}`) },
                {
                  header: t("admin.discoveryRuns.profile"),
                  cell: (run) =>
                    run.profile ? (
                      <>
                        <code>{t("admin.discoveryRuns.pseudonym", { pseudonym: run.profile.pseudonym })}</code>
                        <div className="activity-meta">{[run.profile.targetRole, ...run.profile.locations].join(" · ")}</div>
                      </>
                    ) : (
                      <span className="activity-meta">{t("admin.discoveryRuns.purged")}</span>
                    ),
                },
                { header: t("admin.discoveryRuns.searches"), numeric: true, cell: (run) => run.searches },
                {
                  header: t("admin.discoveryRuns.provider"),
                  cell: (run) => (
                    <>
                      {run.providers.length === 0 ? t("admin.discoveryRuns.noWebSearch") : run.providers.map(providerName).join(" → ")}
                      {run.fallback ? (
                        <>
                          {" "}
                          <Pill tone="danger">{t("admin.discoveryRuns.fellBack")}</Pill>
                        </>
                      ) : null}
                    </>
                  ),
                },
                { header: t("admin.discoveryRuns.pagesRead"), numeric: true, cell: (run) => run.pagesRead },
                { header: t("admin.discoveryRuns.newOffers"), cell: (run) => t("admin.discoveryRuns.newOfExtracted", { new: run.newJobOffers, extracted: run.extracted }) },
                { header: t("admin.discoveryRuns.stop"), cell: (run) => t(`admin.discoveryRuns.stopReasons.${run.stopReason}`) },
                { header: t("admin.discoveryRuns.duration"), numeric: true, cell: (run) => seconds.format(run.durationMs / 1000) },
                { header: t("admin.discoveryRuns.cost"), numeric: true, cell: (run) => eur.format(run.costEur) },
                {
                  header: <span className="visually-hidden">{t("admin.discoveryRuns.open")}</span>,
                  cell: (run) => (
                    <Link prefetch={false} href={hrefOf(filter, run.id)} aria-label={t("admin.discoveryRuns.openLabel", { at: at.format(run.startedAt) })} data-opens-run={run.id}>
                      {t("admin.discoveryRuns.open")}
                    </Link>
                  ),
                },
              ]}
              rows={runs}
              rowKey={(run) => run.id}
              rowAttributes={(run) => ({ "data-run": run.id, "aria-current": run.id === opened?.id ? OPEN_ROW : undefined })}
            />
          </>
        )}
        <p className="activity-meta">{t("admin.discoveryRuns.noCandidate")}</p>

        {opened ? (
          <RunPanel
            key={opened.id}
            run={opened}
            t={t}
            close={hrefOf(filter)}
            at={at}
            seconds={seconds}
            eur={eur}
            aiCalls={readsAiCalls ? runAiCalls(opened) : null}
            jobSearch={opensJobSearches && opened.hasJobSearch ? routes.adminDiscoveryRunJobSearch(opened.id) : null}
          />
        ) : null}
      </div>
    </BackOfficeLayout>
  );
}

/** The funnel's stages, in order, as the Discovery metrics count them. */
const FUNNEL = ["providerUrls", "fetched", "extracted", "alreadyStored", "afterDedup", "matched"] as const satisfies readonly (keyof DiscoveryMetrics["funnel"])[];

/** A run's panel: its Discovery metrics funnel, each search, its Skip reasons, and the links a super-admin has. */
function RunPanel({
  run,
  t,
  close,
  at,
  seconds,
  eur,
  aiCalls,
  jobSearch,
}: {
  run: DiscoveryRun;
  t: T;
  close: string;
  at: Intl.DateTimeFormat;
  seconds: Intl.NumberFormat;
  eur: Intl.NumberFormat;
  /** The Appels IA filter of its calls; null for who does not read them, or once purged. */
  aiCalls: Record<string, string> | null;
  /** Its Job Search's page; null for who does not open it, for a Job Digest's run, or once purged. */
  jobSearch: string | null;
}) {
  const { metrics } = run;
  const widest = Math.max(1, ...FUNNEL.map((stage) => metrics.funnel[stage]));
  const skipped = SKIP_REASONS.filter((reason) => metrics.skipped[reason] > 0);
  /** The job APIs the run searched (France Travail, Fantastic.jobs), with how each went. */
  const sources: { source: "france_travail" | "fantastic_jobs"; part: FranceTravailMetrics }[] = [];
  if (metrics.franceTravail && metrics.franceTravail.status !== "off") sources.push({ source: "france_travail", part: metrics.franceTravail });
  if (metrics.fantasticJobs && metrics.fantasticJobs.status !== "off") sources.push({ source: "fantastic_jobs", part: metrics.fantasticJobs });
  const eur6 = new Intl.NumberFormat(eur.resolvedOptions().locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return (
    <AddressDrawer
      title={run.profile ? [run.profile.targetRole, ...run.profile.locations].join(" · ") : t("admin.discoveryRuns.purgedTitle")}
      closeHref={close}
      opener={`[data-opens-run="${run.id}"]`}
      size="wide"
      data-run-panel={run.id}
    >
      <p className="activity-meta">
        {t(`admin.discoveryRuns.triggers.${run.trigger}`)} · <time dateTime={run.startedAt.toISOString()}>{at.format(run.startedAt)}</time>
        {run.profile ? (
          <>
            {" "}
            · <code>{t("admin.discoveryRuns.pseudonym", { pseudonym: run.profile.pseudonym })}</code>
          </>
        ) : null}
      </p>
      <p>
        {run.providers.length === 0 ? t("admin.discoveryRuns.noWebSearch") : run.providers.map(providerName).join(" → ")} · {seconds.format(run.durationMs / 1000)} · {eur.format(run.costEur)} ·{" "}
        {t("admin.discoveryRuns.stoppedBy", { reason: t(`admin.discoveryRuns.stopReasons.${run.stopReason}`) })}
      </p>
      {run.fallback ? (
        <Note tone="warn" role="status">
          <p>
            {t("admin.discoveryRuns.fallbackDetail", {
              from: providerName(run.fallback.from),
              to: providerName(run.fallback.to),
              reason: t(`failureReasons.${run.fallback.reason}` as "failureReasons.other", { defaultValue: run.fallback.reason }),
            })}
          </p>
        </Note>
      ) : null}

      <section className="stack" aria-labelledby="run-funnel">
        <h3 id="run-funnel">{t("admin.discoveryRuns.funnelTitle")}</h3>
        <dl className="run-funnel">
          {FUNNEL.map((stage) => (
            <div key={stage} className="run-funnel-stage">
              <dt>{t(`admin.discoveryRuns.funnel.${stage}`)}</dt>
              <dd>
                <span className="run-funnel-bar" aria-hidden="true" style={{ width: `${(metrics.funnel[stage] / widest) * 100}%` }} />
                <span className="run-funnel-count">{metrics.funnel[stage]}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p>{t("admin.discoveryRuns.newJobOffers", { count: run.newJobOffers })}</p>
      </section>

      <section className="stack" aria-labelledby="run-searches">
        <h3 id="run-searches">{t("admin.discoveryRuns.searchesTitle")}</h3>
        {run.queriesKept ? null : <p className="activity-meta">{t("admin.discoveryRuns.queriesPurged", { days: String(QUERY_RETENTION_DAYS) })}</p>}
        {run.searches.length === 0 ? (
          <p>{t("admin.discoveryRuns.noSearch")}</p>
        ) : (
          <Table
            label={t("admin.discoveryRuns.searchesTitle")}
            data-testid={TEST_IDS.searches}
            columns={[
              { header: "#", numeric: true, cell: ({ index }) => index + 1 },
              {
                header: t("admin.discoveryRuns.kind"),
                cell: ({ each }) => (
                  <>
                    {t(`admin.discoveryRuns.kinds.${each.kind}`)}
                    {each.site ? <div className="activity-meta">{each.site}</div> : null}
                  </>
                ),
              },
              {
                header: t("admin.discoveryRuns.query"),
                cell: ({ each }) =>
                  each.queries.length === 0 ? (
                    <span className="activity-meta">{t("admin.discoveryRuns.queryPurged")}</span>
                  ) : (
                    <ul className="run-queries">
                      {each.queries.map((query, position) => (
                        <li key={position}>
                          <code>{query}</code>
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                header: t("admin.discoveryRuns.provider"),
                cell: ({ each }) => (
                  <>
                    {providerName(each.provider)}
                    {each.fallback ? (
                      <>
                        {" "}
                        <Pill tone="danger">{t("admin.discoveryRuns.fallbackShort")}</Pill>
                      </>
                    ) : null}
                  </>
                ),
              },
              { header: t("admin.discoveryRuns.page"), numeric: true, cell: ({ each }) => each.page },
              { header: t("admin.discoveryRuns.results"), numeric: true, cell: ({ each }) => each.results },
              { header: t("admin.discoveryRuns.newOffersShort"), numeric: true, cell: ({ each }) => each.newJobOffers },
              { header: t("admin.discoveryRuns.cost"), numeric: true, cell: ({ each }) => eur6.format(each.costEur) },
            ]}
            rows={run.searches.map((each, index) => ({ each, index }))}
            rowKey={({ index }) => String(index)}
          />
        )}
      </section>

      {sources.length > 0 ? (
        <section className="stack" aria-labelledby="run-sources">
          <h3 id="run-sources">{t("admin.discoveryRuns.sourcesTitle")}</h3>
          <ul>
            {sources.map(({ source, part }) => (
              <li key={source}>
                {t(`admin.searchSites.sources.names.${source}`)} : {t(`admin.discoveryRuns.sourceStatuses.${part.status}`)} · {t("admin.discoveryRuns.sourceOffers", { count: part.offers })} ·{" "}
                {t("admin.discoveryRuns.sourceCalls", { count: part.calls })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="run-skipped">
        <h3 id="run-skipped">{t("admin.discoveryRuns.skippedTitle")}</h3>
        {skipped.length === 0 ? (
          <p>{t("admin.discoveryRuns.noneSkipped")}</p>
        ) : (
          <Table
            label={t("admin.discoveryRuns.skippedTitle")}
            columns={[
              { header: t("admin.discoveryRuns.skipReason"), cell: (reason) => t(`admin.discoveryRuns.skipReasons.${reason}`) },
              { header: t("admin.discoveryRuns.pages"), numeric: true, cell: (reason) => metrics.skipped[reason] },
            ]}
            rows={skipped}
            rowKey={(reason) => reason}
          />
        )}
      </section>

      {aiCalls || jobSearch ? (
        <p className="run-links">
          {aiCalls ? (
            <Link prefetch={false} href={routes.adminAiMessages(aiCalls)}>
              {t("admin.discoveryRuns.aiCallsLink")}
            </Link>
          ) : null}
          {jobSearch ? (
            <Link prefetch={false} href={jobSearch}>
              {t("admin.discoveryRuns.jobSearchLink")}
            </Link>
          ) : null}
        </p>
      ) : null}
    </AddressDrawer>
  );
}
