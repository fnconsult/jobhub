import {
  JOB_DIGEST_FREQUENCIES,
  JOB_DISCOVERY_SOURCES,
  PLAN_FEATURES,
  PLAN_STATUSES,
  toolById,
  type JobDigestFrequency,
  type JobDiscoverySource,
  type PlanFeature,
  type PlanStatus,
} from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { isBackOfficeRole } from "@/admin/access";
import {
  BACK_OFFICE_OUTCOMES,
  BACK_OFFICE_SECTIONS,
  isBackOfficeOutcome,
  isBackOfficeSection,
  isSecretAction,
  RETENTION_YEARS,
  type BackOfficeAuditEntry,
  type BackOfficeSection,
  type Recorded,
} from "@/admin/back-office";
import { journalChanges, type JournalChange } from "@/admin/journal-changes";
import { journalFieldName, SEARCH_SITES_SECTIONS } from "@/admin/journal-fields";
import { journalTimeline, toolCallOk, type JournalLine } from "@/admin/journal-timeline";
import { ACTIVITY_RETENTION_MONTHS } from "@/email-intake/activity";
import { getEmailIntakeActivity } from "@/email-intake/server";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { FilterLinks } from "@/design/FilterLinks";
import { Properties, Property } from "@/design/Properties";
import { Table } from "@/design/Table";
import { couponDiscountLabel } from "@/billing/coupon-label";
import { getBilling } from "@/billing/server";
import { EVAL_IN_VIEW_KINDS, type EvalInView } from "@/evals/cases";
import { GUARDRAIL_LANGUAGES, GUARDRAIL_SETTINGS, isGuardrailId, type GuardrailLanguage, type GuardrailSetting } from "@/guardrails";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { PageIntro } from "@/components/PageIntro";
import type { ActivityTabId } from "@/admin/activity";
import { ActivityTabs } from "../ActivityTabs";
import "../activite.css";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";
import type { ToolCall } from "@/tools";
import { latestToolCallsNow } from "@/tools/server";
import { isSignalementStatus } from "@/signalements/values";
import { UNANSWERED_QUESTION_STATUSES, type UnansweredQuestionStatus } from "@/unanswered-questions";

/** This tab of Activité (#404). */
const TAB: ActivityTabId = "audit";

/** How many entries the Journal shows at most. */
const LIMIT = 200;

/** The version a Coaching Playbooks entry concerns, recorded after (or before) the change. */
const versionOf = (entry: BackOfficeAuditEntry): number | null => {
  for (const value of [entry.after, entry.before]) {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.version === "number") return value.version;
  }
  return null;
};

/** `aria-current` of the link to the section being shown. */
/** The filters' id for « Toutes », which the address leaves out. */
const ALL = "all";

/** The Outils filter (#234): the calls to the Tools, next to every Back Office change. */
const TOOLS_FILTER = "tools";
/** The Boîtes reliées filter (#449): the Linked mailbox events, next to every Back Office change; they name no Candidate. */
const LINKED_MAILBOXES_FILTER = "linked_mailboxes";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("audit");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.audit")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Activité › Actions des administrateurs (formerly the Journal, #404): Administrators read the Back Office Audit: every change made in the Back Office, newest first, by
 * section. With the Outils filter (those who may read the Tools), the calls to the Tools beside them; with the Boîtes
 * reliées filter, the Linked mailbox events (switched on, replaced, off, daily cap reached), naming no Candidate.
 * Every attempt that failed or was refused is there too (#263): its Résultat, its Failure Reason in
 * Changes, and its technical detail behind « Détail technique ». The Résultat filter combines with the
 * section's in the URL.
 */
/** The Journal's columns, in order, each named by its `admin.journal` key. */
const COLUMNS = ["at", "administrator", "section", "target", "action", "outcome", "changes"] as const;
/** How a row says what kind of line it is (`data-kind`), for the tests. */
const KINDS = { linkedMailbox: "linked-mailbox", toolCall: "tool-call" } as const;
/** A line of the Journal, its cells drawn by its kind: an Administrator's action, a Tool call, a Linked mailbox's event. */
type JournalRow = { key: string; kind?: string; cells: Record<(typeof COLUMNS)[number], ReactNode> };

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ section?: string; outcome?: string }> }) {
  const { access } = await requireBackOffice("audit");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { section: requested, outcome: requestedOutcome } = await searchParams;
  const readsTools = access.can("tools", "read");
  const withTools = requested === TOOLS_FILTER && readsTools;
  const withLinkedMailboxes = requested === LINKED_MAILBOXES_FILTER;
  /** Outils or Boîtes reliées: other lines beside the changes, so the limit counts lines, not entries. */
  const beside = withTools || withLinkedMailboxes;
  const section = isBackOfficeSection(requested) ? requested : undefined;
  const outcome = isBackOfficeOutcome(requestedOutcome) ? requestedOutcome : undefined;
  /** The section filter as the URL holds it, kept when the Résultat filter changes. */
  const shownSection = withTools ? TOOLS_FILTER : withLinkedMailboxes ? LINKED_MAILBOXES_FILTER : section;
  const [entries, plans, toolCalls, linkedMailboxEvents] = await Promise.all([
    getBackOffice().journal({ section, outcome, limit: LIMIT }),
    getBilling().plans(),
    withTools ? latestToolCallsNow(LIMIT, { ok: outcome && toolCallOk(outcome) }) : Promise.resolve([]),
    withLinkedMailboxes ? getEmailIntakeActivity().linkedMailboxEvents(LIMIT) : Promise.resolve([]),
  ]);
  const lines: JournalLine[] = journalTimeline(entries, { toolCalls, linkedMailboxEvents }, LIMIT, outcome);
  /** What an entry changed, named as the Back Office names it: a Plan as it is named now; an unknown key stays as recorded. */
  const target = (entry: BackOfficeAuditEntry): string => {
    if (entry.section === "plans" || entry.section === "plan_quotas") return plans.find((plan) => plan.key === entry.target)?.name[locale] ?? entry.target;
    if (entry.section === "job_discovery_sources" && JOB_DISCOVERY_SOURCES.includes(entry.target as JobDiscoverySource)) {
      return t(`admin.searchSites.sources.names.${entry.target as JobDiscoverySource}`);
    }
    if (entry.section === "guardrails" && isGuardrailId(entry.target)) return t(`admin.guardrails.names.${entry.target}`);
    if (entry.section === "recipients_outside_eu") return toolById(entry.target)?.name ?? entry.target;
    return entry.target;
  };
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);
  const milliseconds = new Intl.NumberFormat(locale, { style: "unit", unit: "millisecond" });
  /** A tool call's outcome, as the Tool's Outils page says it, and how long it took. */
  const callResult = (call: ToolCall): string => {
    const status = call.httpStatus === null ? null : t("admin.tools.httpStatus", { status: call.httpStatus });
    const outcome = call.ok ? (status ? `${t("admin.tools.ok")} (${status})` : t("admin.tools.ok")) : `${t("admin.tools.failed")} (${status ?? t("admin.tools.noAnswer")})`;
    return t("admin.journal.toolCallResult", { outcome, duration: milliseconds.format(call.durationMs) });
  };

  const fieldName = (entrySection: BackOfficeSection, field: string): string => journalFieldName(t, entrySection, field);
  const shown = (entrySection: BackOfficeSection, field: string | null, value: Recorded): string => {
    if (entrySection === "job_sites" && field === "postingPages" && value === null) return t("admin.searchSites.jobSites.anyPostingPage");
    if (SEARCH_SITES_SECTIONS.includes(entrySection) && field === "enabled" && typeof value === "boolean") {
      return t(value ? "admin.searchSites.enabled" : "admin.searchSites.disabled");
    }
    if (entrySection === "plans") {
      if (field === "stripeProductId" && value === null) return t("admin.plans.noProduct");
      if (field === "status" && PLAN_STATUSES.includes(value as PlanStatus)) return t(`admin.plans.status.${value as PlanStatus}`);
      if (field === "features" && Array.isArray(value)) {
        return value.length ? value.map((feature) => (PLAN_FEATURES.includes(feature as PlanFeature) ? t(`admin.plans.featureNames.${feature as PlanFeature}`) : String(feature))).join(", ") : t("admin.plans.noFeatures");
      }
      if (field === "name" && typeof value === "object" && value !== null && !Array.isArray(value)) return `${String(value.fr)} / ${String(value.en)}`;
    }
    if (entrySection === "coupons") {
      if (field === "discount" && typeof value === "object" && value !== null && !Array.isArray(value)) {
        return couponDiscountLabel(typeof value.percentOff === "number" ? { percentOff: value.percentOff } : { amountOff: Number(value.amountOff), currency: String(value.currency ?? "eur") }, locale);
      }
      if (field === "duration") {
        if (value === "once" || value === "forever") return t(`admin.coupons.durations.${value}`);
        if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.months === "number") return t("billing.coupon.monthsOnly", { count: value.months });
      }
      if (field === "plans") return value === null ? t("admin.coupons.allPlans") : Array.isArray(value) ? value.map((key) => plans.find((plan) => plan.key === key)?.name[locale] ?? String(key)).join(", ") : String(value);
      if (field === "expiresAt") return typeof value === "string" ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Paris" }).format(new Date(value)) : t("admin.coupons.noExpiry");
      if (typeof value === "boolean") return t(value ? "admin.coupons.yes" : "admin.coupons.no");
    }
    if (entrySection === "coaching_playbooks") {
      if (field === "model" && value === null) return t("admin.coachingPlaybooks.providerDefault");
      if (field === "effort" && (value === "low" || value === "medium" || value === "high")) return t(`admin.coachingPlaybooks.efforts.${value}`);
      if (field === "validatedAt" && typeof value === "string") return at.format(new Date(value));
      if (field === "archived" && typeof value === "boolean") return t(value ? "admin.coachingPlaybooks.archived" : "admin.coachingPlaybooks.active");
    }
    if (entrySection === "guardrails") {
      if (field === "setting" && GUARDRAIL_SETTINGS.includes(value as GuardrailSetting)) return t(`admin.guardrails.settings.${value as GuardrailSetting}`);
      if (field === "language" && GUARDRAIL_LANGUAGES.includes(value as GuardrailLanguage)) return t(`admin.guardrails.languages.${value as GuardrailLanguage}`);
      if (field === "validatedAt" && typeof value === "string") return at.format(new Date(value));
    }
    if (entrySection === "recipients_outside_eu") {
      if (field === "residency" && (value === "eu" || value === "outside_eu" || value === "unknown")) return t(`admin.tools.residencies.${value}`);
      if (field === "privacyPolicy" && value === null) return t("admin.tools.uncoveredRecipient.noPolicyValue");
      if (field === "coverage" && value === "uncovered") return t("admin.tools.uncoveredRecipient.coverage.uncovered");
    }
    if (entrySection === "platform_settings" && field === "source" && (value === "back_office" || value === "env" || value === "default")) return t(`admin.platformSettings.sources.${value}`);
    if (entrySection === "unanswered_questions" && field === "status" && UNANSWERED_QUESTION_STATUSES.includes(value as UnansweredQuestionStatus)) {
      return t(`admin.unansweredQuestions.statuses.${value as UnansweredQuestionStatus}`);
    }
    if (entrySection === "signalements") {
      if (field === "status" && isSignalementStatus(value)) return t(`admin.signalements.statuses.${value}`);
      if (field === "reply" && (value === "none" || value === "written" || value === "changed")) return t(`admin.signalements.replyStates.${value}`);
    }
    if (entrySection === "eval_cases" && field === "inViewKind" && EVAL_IN_VIEW_KINDS.includes(value as EvalInView["kind"])) return t(`admin.evals.cases.inViewKinds.${value as EvalInView["kind"]}`);
    if (value === null) return t(entrySection === "plan_quotas" ? "admin.journal.unlimited" : "admin.journal.empty");
    if (entrySection === "plan_quotas" && field === "jobDigest" && JOB_DIGEST_FREQUENCIES.includes(value as JobDigestFrequency)) {
      return t(`billing.jobDigest.${value as JobDigestFrequency}`);
    }
    if (entrySection === "roles" && field === "roles" && Array.isArray(value)) {
      return value.map((role) => (isBackOfficeRole(role) ? t(`admin.roles.${role}`) : String(role))).join(", ");
    }
    if (typeof value === "number") return number.format(value);
    if (typeof value === "string") return value === "" ? t("admin.journal.empty") : value;
    return JSON.stringify(value);
  };
  const changeLine = (entry: BackOfficeAuditEntry, change: JournalChange): string => {
    const field = change.field === null ? t(`admin.journal.sections.${entry.section}`) : fieldName(entry.section, change.field);
    const before = change.before === undefined ? "" : shown(entry.section, change.field, change.before);
    const after = change.after === undefined ? "" : shown(entry.section, change.field, change.after);
    if (change.before === undefined) return t("admin.journal.set", { field, after });
    if (change.after === undefined) return t("admin.journal.removed", { field, before });
    return t("admin.journal.changed", { field, before, after });
  };

  return (
    <BackOfficeLayout access={access} title={t("admin.activity.title")}>
      <div className="activite">
        <ActivityTabs access={access} shown={TAB} />
        <PageIntro t={t} page={TAB} subject={t("admin.activity.tabs.audit")} values={{ years: String(RETENTION_YEARS) }} />
        <FilterLinks
          label={t("admin.journal.filter")}
          shown={shownSection ?? ALL}
          links={[
            ...[undefined, ...BACK_OFFICE_SECTIONS].map((option) => ({
              id: option ?? ALL,
              href: routes.adminAudit({ section: option, outcome }),
              label: option ? t(`admin.journal.sections.${option}`) : t("admin.journal.all"),
            })),
            ...(readsTools ? [{ id: TOOLS_FILTER, href: routes.adminAudit({ section: TOOLS_FILTER, outcome }), label: t("admin.journal.tools") }] : []),
            { id: LINKED_MAILBOXES_FILTER, href: routes.adminAudit({ section: LINKED_MAILBOXES_FILTER, outcome }), label: t("admin.journal.linkedMailboxes") },
          ]}
        />
        <FilterLinks
          label={t("admin.journal.outcomeFilter")}
          shown={outcome ?? ALL}
          links={[undefined, ...BACK_OFFICE_OUTCOMES].map((option) => ({
            id: option ?? ALL,
            href: routes.adminAudit({ section: shownSection, outcome: option }),
            label: t(`admin.journal.outcomeFilters.${option ?? "all"}`),
          }))}
        />
        {withTools ? <p>{t("admin.journal.toolsIntro")}</p> : null}
        {withLinkedMailboxes ? <p>{t("admin.journal.linkedMailboxesIntro", { months: String(ACTIVITY_RETENTION_MONTHS) })}</p> : null}
        {lines.length === 0 ? (
          <p>{t("admin.journal.none")}</p>
        ) : (
          <Table
            label={t(withTools ? "admin.journal.toolsCaption" : withLinkedMailboxes ? "admin.journal.linkedMailboxesCaption" : "admin.journal.caption")}
            columns={COLUMNS.map((column) => ({ key: column, header: t(`admin.journal.${column}`), rowHeader: column === "at", cell: (row: JournalRow) => row.cells[column] }))}
            rows={lines.map((line, index): JournalRow => {
              if (line.kind === "linked_mailbox") {
                const { event } = line;
                return {
                  key: `mailbox-${event.id}`,
                  kind: KINDS.linkedMailbox,
                  cells: {
                    at: <time dateTime={event.at.toISOString()}>{at.format(event.at)}</time>,
                    administrator: t(event.event === "daily_cap_reached" ? "admin.journal.byEmailIntake" : "admin.journal.byCandidate"),
                    section: t("admin.journal.linkedMailboxes"),
                    target: t("admin.journal.linkedMailboxTarget"),
                    action: t(`admin.journal.linkedMailboxEvents.${event.event}`),
                    outcome: t("admin.journal.outcomes.succeeded"),
                    changes: t(`admin.journal.linkedMailboxEventDetails.${event.event}`),
                  },
                };
              }
              if (line.kind === "tool_call") {
                const { tool, call } = line;
                return {
                  key: `call-${call.at.toISOString()}-${index}`,
                  kind: KINDS.toolCall,
                  cells: {
                    at: <time dateTime={call.at.toISOString()}>{at.format(call.at)}</time>,
                    administrator: t("admin.journal.byJobbbox"),
                    section: t("admin.journal.tools"),
                    target: <Link href={routes.adminTool(tool.id)}>{tool.name}</Link>,
                    action: (
                      <>
                        {t("admin.journal.toolCall")} <code>{call.operation}</code>
                      </>
                    ),
                    outcome: t(`admin.journal.outcomes.${call.ok ? "succeeded" : "failed"}`),
                    changes: callResult(call),
                  },
                };
              }
              const { entry } = line;
              const changes = journalChanges(entry.before, entry.after);
              return {
                key: entry.id,
                cells: {
                  at: <time dateTime={entry.at.toISOString()}>{at.format(entry.at)}</time>,
                  administrator: (
                    <>
                      {entry.actor.email}
                      {entry.actor.candidateId === null ? ` (${t("admin.journal.accountDeleted")})` : null}
                    </>
                  ),
                  section: t(`admin.journal.sections.${entry.section}`),
                  target: (
                    <>
                      {target(entry)}
                      {entry.section === "coaching_playbooks" && versionOf(entry) !== null ? (
                        <>
                          {" "}
                          (<Link href={routes.adminCoachingPlaybook(entry.target, versionOf(entry)!)}>{t("admin.journal.viewVersion", { version: String(versionOf(entry)) })}</Link>)
                        </>
                      ) : null}
                      {entry.section === "eval_cases" ? (
                        <>
                          {" "}
                          (<Link href={`${routes.adminCoachingPlaybook(entry.target)}#eval-cases`}>{t("admin.journal.viewEvalCases")}</Link>)
                        </>
                      ) : null}
                      {entry.section === "guardrails" && isGuardrailId(entry.target) ? (
                        <>
                          {" "}
                          (<Link href={`${routes.adminGuardrails}#${entry.target}`}>{t("admin.journal.viewGuardrail")}</Link>)
                        </>
                      ) : null}
                    </>
                  ),
                  action: t(`admin.journal.actions.${entry.action}`),
                  outcome: t(`admin.journal.outcomes.${entry.outcome}`),
                  changes: entry.failure ? (
                    <>
                      <p>{t("admin.journal.failed", { tried: t(`admin.journal.actions.${entry.failure.tried}`), reason: t(`failureReasons.${entry.failure.reason}`) })}</p>
                      {entry.failure.field ? <p>{t("admin.journal.fieldAtFault", { field: fieldName(entry.section, entry.failure.field) })}</p> : null}
                      {entry.failure.technical ? (
                        <details>
                          <summary>{t("admin.journal.technicalDetail")}</summary>
                          <Properties>
                            <Property term={t("admin.journal.technical.class")}>{entry.failure.technical.class}</Property>
                            {entry.failure.technical.provider ? <Property term={t("admin.journal.technical.provider")}>{entry.failure.technical.provider}</Property> : null}
                            {entry.failure.technical.status === undefined ? null : <Property term={t("admin.journal.technical.status")}>{entry.failure.technical.status}</Property>}
                            <Property term={t("admin.journal.technical.message")}>
                              <code>{entry.failure.technical.message}</code>
                            </Property>
                          </Properties>
                        </details>
                      ) : null}
                    </>
                  ) : entry.action === "viewed" || entry.action === "tested" ? null : isSecretAction(entry.action) ? (
                    t(`admin.journal.secret.${entry.action}`)
                  ) : changes.length === 0 ? (
                    t("admin.journal.unchanged")
                  ) : (
                    <ul className="activity-changes">
                      {changes.map((change) => (
                        <li key={change.field ?? ""}>{changeLine(entry, change)}</li>
                      ))}
                    </ul>
                  ),
                },
              };
            })}
            rowKey={(row) => row.key}
            rowAttributes={(row) => ({ "data-kind": row.kind })}
          />
        )}
        {beside ? (
          lines.length === LIMIT ? (
            <p>{t("admin.journal.toolsLimit", { count: String(LIMIT) })}</p>
          ) : null
        ) : entries.length === LIMIT ? (
          <p>{t("admin.journal.limit", { count: String(LIMIT) })}</p>
        ) : null}
      </div>
    </BackOfficeLayout>
  );
}
