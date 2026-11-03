import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import type { IntroPage } from "@/admin/page-intro";
import { requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import { openPullRequestStage, type Caveat, type EnvironmentStatus, type Evidence, type Feature, type Headline, type Stage, type Ticket } from "@/delivery-status";
import { DELIVERY_STATUS_TTL_MS, deliveryStatusNow } from "@/delivery-status/server";
import { Note } from "@/design/Note";
import { Status, type StatusTone } from "@/design/Pill";
import { Table } from "@/design/Table";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { keyHref } from "@/platform-settings/parametres";
import { routes } from "@/routes";
import "../section.css";

/** This section's one-line intro (#466). */
const INTRO: IntroPage = "deliveryStatus";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to others would still carry the back office's title.
  await requireBackOffice("deliveryStatus");
  const t = await getServerT();
  return { title: `${t("admin.deliveryStatus.title")} · ${t("admin.title")}`, robots: { index: false } };
}

const STAGE_TONE: Record<Stage, StatusTone> = {
  triage: "neutral",
  readyHuman: "neutral",
  readyAgent: "neutral",
  blocked: "danger",
  claimed: "warn",
  implementing: "warn",
  inReview: "warn",
  merged: "neutral",
  onStaging: "success",
  onProduction: "success",
  closedNoPr: "neutral",
  dropped: "neutral",
};

const short = (sha: string) => sha.slice(0, 8);

/**
 * Livraison: what is being built and where it runs, read live from GitHub (tickets, pull requests, deployments) and
 * checked against each environment's /api/health. Super-admins, Technique and Support; read-only. GitHub is read again
 * after 5 minutes, or at once with « Actualiser ».
 */
export default async function DeliveryStatusPage({ searchParams }: { searchParams: Promise<{ actualiser?: string }> }) {
  const { access } = await requireBackOffice("deliveryStatus");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const read = await deliveryStatusNow({ refresh: (await searchParams).actualiser !== undefined });
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" });
  const minutes = String(DELIVERY_STATUS_TTL_MS / 60_000);
  const sheet = keyHref("GITHUB_STATUS_TOKEN") ?? routes.adminPlatformSettings;

  const envName = (name: EnvironmentStatus["name"]) => t(`admin.deliveryStatus.environments.names.${name}`);
  const issue = (number: number, url?: string) => (url ? <a href={url}>#{number}</a> : <>#{number}</>);
  const stage = (value: Stage) => <Status tone={STAGE_TONE[value]}>{t(`admin.deliveryStatus.stages.${value}`)}</Status>;
  const evidence = (e: Evidence) => {
    const parts: ReactNode[] = [];
    if (e.pullRequest) {
      const pr = <a href={e.pullRequest.url}>{t("admin.deliveryStatus.pullRequest", { number: e.pullRequest.number })}</a>;
      if (e.pullRequest.mergedAt && e.pullRequest.mergeCommit)
        parts.push(
          <span key="pr">
            {pr} {t("admin.deliveryStatus.evidence.merged", { date: day.format(new Date(e.pullRequest.mergedAt)), commit: short(e.pullRequest.mergeCommit) })}
          </span>,
        );
      else
        parts.push(
          <span key="pr">
            {pr}
            {e.pullRequest.checks ? ` ${t("admin.deliveryStatus.evidence.checks", { state: e.pullRequest.checks })}` : ""}
          </span>,
        );
    }
    if (e.blockedBy?.length) parts.push(<span key="blocked">{t("admin.deliveryStatus.evidence.blockedBy", { issues: e.blockedBy.map((n) => `#${n}`).join(", ") })}</span>);
    if (e.assignees?.length) parts.push(<span key="assignees">{t("admin.deliveryStatus.evidence.assigned", { people: e.assignees.join(", ") })}</span>);
    if (e.labels) parts.push(<span key="labels">{e.labels.length ? e.labels.join(", ") : t("admin.deliveryStatus.evidence.noTriageLabel")}</span>);
    if (e.uncompared?.length) parts.push(<span key="uncompared">{t("admin.deliveryStatus.evidence.uncompared", { environments: e.uncompared.map(envName).join(", ") })}</span>);
    return parts.length ? parts.reduce<ReactNode[]>((all, part, index) => (index ? [...all, " · ", part] : [part]), []) : null;
  };
  const headline = (h: Headline) => (h.kind === "building" ? t("admin.deliveryStatus.headlines.building", { tickets: h.tickets.map((n) => `#${n}`).join(", ") }) : t(`admin.deliveryStatus.headlines.${h.kind}`));
  const caveat = (c: Caveat) => {
    switch (c.kind) {
      case "branchDeployed":
        return t("admin.deliveryStatus.caveats.branchDeployed", { environment: envName(c.environment), ref: c.ref });
      case "liveDiffers":
        return t("admin.deliveryStatus.caveats.liveDiffers", { environment: envName(c.environment), live: short(c.live), deployed: short(c.deployed) });
      case "liveUnverified":
        return t("admin.deliveryStatus.caveats.liveUnverified", { environment: envName(c.environment) });
      case "openButMerged":
        return t("admin.deliveryStatus.caveats.openButMerged", { issue: `#${c.issue}`, pullRequest: `#${c.pullRequest}` });
      default:
        return t(`admin.deliveryStatus.caveats.${c.kind}`);
    }
  };
  const live = (env: EnvironmentStatus) => {
    if (env.missing) return t("admin.deliveryStatus.environments.missing");
    if (!env.deployment || !env.live) return t("admin.deliveryStatus.environments.noDeployment");
    if (env.live.checked) return env.live.revision === env.deployment.sha ? <Status tone="success">{t("admin.deliveryStatus.environments.liveMatches")}</Status> : <Status tone="danger">{t("admin.deliveryStatus.environments.liveDiffers", { commit: short(env.live.revision) })}</Status>;
    const reason = env.live.reason;
    return <Status tone="warn">{reason.kind === "status" ? t("admin.deliveryStatus.environments.unverified.status", { status: reason.status }) : t(`admin.deliveryStatus.environments.unverified.${reason.kind}`)}</Status>;
  };
  const ticketTable = (label: string, tickets: readonly Ticket[]) => (
    <Table
      label={label}
      rowKey={(ticket) => String(ticket.number)}
      rows={tickets}
      columns={[
        {
          header: t("admin.deliveryStatus.ticket"),
          rowHeader: true,
          cell: (ticket) => (
            <>
              {issue(ticket.number, ticket.url)} {ticket.title}
            </>
          ),
        },
        { header: t("admin.deliveryStatus.stage"), cell: (ticket) => stage(ticket.stage) },
        { header: t("admin.deliveryStatus.evidenceHeader"), cell: (ticket) => evidence(ticket.evidence) },
      ]}
    />
  );
  const feature = (f: Feature, epicTitle?: string) => (
    <div key={`${f.number}-${f.direct}`}>
      <h3>
        {f.direct ? t("admin.deliveryStatus.directTickets") : <>{issue(f.number, f.url)} {f.title}</>}
        <span className="section-meta">{headline(f.headline)}</span>
      </h3>
      {f.counts.length ? <p className="section-meta">{f.counts.map((c) => t("admin.deliveryStatus.count", { count: c.count, stage: t(`admin.deliveryStatus.stages.${c.stage}`) })).join(" · ")}</p> : null}
      {f.tickets.length ? ticketTable(f.direct ? (epicTitle ?? f.title) : f.title, f.tickets) : null}
    </div>
  );

  return (
    <BackOfficeLayout access={access} title={t("admin.deliveryStatus.title")}>
      <div className="section-page">
        <PageIntro t={t} page={INTRO} subject={t("admin.deliveryStatus.title")} values={{ minutes }} />
        {read.state !== "ok" ? (
          <Note tone={read.state === "failed" ? "warn" : "danger"} title={t(`admin.deliveryStatus.unavailable.${read.state}.title`)}>
            <p>
              {t(`admin.deliveryStatus.unavailable.${read.state}.text`)} {read.state !== "failed" ? <Link href={sheet}>{t("admin.deliveryStatus.unavailable.sheet")}</Link> : null}
            </p>
          </Note>
        ) : (
          <>
            <p className="section-meta">
              {t("admin.deliveryStatus.readAt", { at: at.format(read.readAt), repository: read.status.repository, days: read.status.closedDays })}{" "}
              <Link prefetch={false} href={`${routes.adminDeliveryStatus}?actualiser=1`}>
                {t("admin.deliveryStatus.refresh")}
              </Link>
            </p>

            <section className="section-block" aria-labelledby="delivery-environments">
              <h2 id="delivery-environments">{t("admin.deliveryStatus.environments.title")}</h2>
              <Table
                label={t("admin.deliveryStatus.environments.title")}
                rowKey={(env) => env.name}
                rows={read.status.environments}
                columns={[
                  { header: t("admin.deliveryStatus.environments.environment"), rowHeader: true, cell: (env) => envName(env.name) },
                  {
                    header: t("admin.deliveryStatus.environments.commit"),
                    cell: (env) => (env.deployment ? <a href={`https://github.com/${read.status.repository}/commit/${env.deployment.sha}`}><code>{short(env.deployment.sha)}</code></a> : "—"),
                  },
                  { header: t("admin.deliveryStatus.environments.when"), cell: (env) => (env.deployment ? at.format(new Date(env.deployment.at)) : "—") },
                  {
                    header: t("admin.deliveryStatus.environments.from"),
                    cell: (env) =>
                      env.deployment ? (
                        <>
                          <code>{env.deployment.ref}</code>
                          {env.deployment.runUrl ? (
                            <>
                              {" "}
                              <a href={env.deployment.runUrl}>{t("admin.deliveryStatus.environments.run")}</a>
                            </>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      ),
                  },
                  { header: t("admin.deliveryStatus.environments.live"), cell: live },
                ]}
              />
              {read.status.mainVersusStaging ? (
                <p className="section-meta">
                  {t("admin.deliveryStatus.environments.mainAhead", { count: read.status.mainVersusStaging.ahead })}
                  {read.status.mainVersusStaging.behind ? ` ${t("admin.deliveryStatus.environments.mainBehind", { count: read.status.mainVersusStaging.behind })}` : ""}
                </p>
              ) : null}
            </section>

            <section className="section-block" aria-labelledby="delivery-in-flight">
              <h2 id="delivery-in-flight">{t("admin.deliveryStatus.inFlight.title")}</h2>
              {read.status.inFlight.tickets.length + read.status.inFlight.pullRequests.length === 0 ? (
                <p>{t("admin.deliveryStatus.inFlight.none")}</p>
              ) : (
                <Table
                  label={t("admin.deliveryStatus.inFlight.title")}
                  rowKey={(row) => row.key}
                  rows={[
                    ...read.status.inFlight.tickets.map(({ ticket, under }) => ({ key: `t${ticket.number}`, name: <>{issue(ticket.number, ticket.url)} {ticket.title}</>, stage: stage(ticket.stage), under: issue(under), evidence: evidence(ticket.evidence) })),
                    ...read.status.inFlight.pullRequests.map((pr) => ({
                      key: `p${pr.number}`,
                      name: (
                        <>
                          <a href={pr.url}>{t("admin.deliveryStatus.pullRequest", { number: pr.number })}</a> {pr.title}
                        </>
                      ),
                      stage: stage(openPullRequestStage(pr.draft)),
                      under: "—",
                      evidence: pr.closes.length ? t("admin.deliveryStatus.inFlight.closesUntracked", { issues: pr.closes.map((n) => `#${n}`).join(", ") }) : t("admin.deliveryStatus.inFlight.closesNothing"),
                    })),
                  ]}
                  columns={[
                    { header: t("admin.deliveryStatus.ticket"), rowHeader: true, cell: (row) => row.name },
                    { header: t("admin.deliveryStatus.stage"), cell: (row) => row.stage },
                    { header: t("admin.deliveryStatus.inFlight.under"), cell: (row) => row.under },
                    { header: t("admin.deliveryStatus.evidenceHeader"), cell: (row) => row.evidence },
                  ]}
                />
              )}
            </section>

            <section className="section-block" aria-labelledby="delivery-epics">
              <h2 id="delivery-epics">{t("admin.deliveryStatus.epics.title")}</h2>
              {read.status.epics.length + read.status.orphans.length === 0 ? <p>{t("admin.deliveryStatus.epics.none")}</p> : null}
              {read.status.epics.map((epic) => (
                <section key={epic.number} className="section-block" aria-labelledby={`delivery-epic-${epic.number}`}>
                  <h3 id={`delivery-epic-${epic.number}`}>
                    {issue(epic.number, epic.url)} {epic.title}
                    {epic.closed ? <span className="section-meta">{t("admin.deliveryStatus.epics.closed")}</span> : null}
                  </h3>
                  <p className="section-meta">{epic.discovery.total ? t("admin.deliveryStatus.epics.discovery", { closed: epic.discovery.closed, total: epic.discovery.total }) : t("admin.deliveryStatus.epics.noDiscovery")}</p>
                  {epic.features.length ? epic.features.map((f) => feature(f, epic.title)) : <p>{t("admin.deliveryStatus.epics.noTickets")}</p>}
                </section>
              ))}
              {read.status.orphans.map((orphan) => (
                <section key={orphan.epic ?? "none"} className="section-block">
                  <h3>{orphan.epic ? t("admin.deliveryStatus.epics.otherEpic", { epic: `#${orphan.epic}` }) : t("admin.deliveryStatus.epics.noEpic")}</h3>
                  {orphan.features.map((f) => feature(f))}
                </section>
              ))}
            </section>

            <section className="section-block" aria-labelledby="delivery-caveats">
              <h2 id="delivery-caveats">{t("admin.deliveryStatus.caveats.title")}</h2>
              <ul>
                {read.status.caveats.map((c) => (
                  <li key={JSON.stringify(c)}>{caveat(c)}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </BackOfficeLayout>
  );
}
