import {
  JOB_DIGEST_FREQUENCIES,
  JOB_DISCOVERY_SOURCES,
  PLAN_FEATURES,
  PLAN_STATUSES,
  type JobDigestFrequency,
  type JobDiscoverySource,
  type PlanFeature,
  type PlanStatus,
} from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
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
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { couponDiscountLabel } from "@/billing/coupon-label";
import { getBilling } from "@/billing/server";
import { EVAL_IN_VIEW_KINDS, type EvalInView } from "@/evals/cases";
import { GUARDRAIL_LANGUAGES, GUARDRAIL_SETTINGS, isGuardrailId, type GuardrailLanguage, type GuardrailSetting } from "@/guardrails";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import type { ActivityTabId } from "@/admin/activity";
import { ActivityTabs } from "../ActivityTabs";
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
const CURRENT = "page";

/** The Outils filter (#234): the calls to the Tools, next to every Back Office change. */
const TOOLS_FILTER = "tools";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("audit");
  const t = await getServerT();
  return { title: `${t("admin.activity.tabs.audit")} · ${t("admin.activity.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/**
 * Activité › Actions des administrateurs (formerly the Journal, #404): Administrators read the Back Office Audit: every change made in the Back Office, newest first, by
 * section. With the Outils filter (those who may read the Tools), the calls to the Tools beside them.
 * Every attempt that failed or was refused is there too (#263): its Résultat, its Failure Reason in
 * Changes, and its technical detail behind « Détail technique ». The Résultat filter combines with the
 * section's in the URL.
 */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ section?: string; outcome?: string }> }) {
  const { access } = await requireBackOffice("audit");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const { section: requested, outcome: requestedOutcome } = await searchParams;
  const readsTools = access.can("tools", "read");
  const withTools = requested === TOOLS_FILTER && readsTools;
  const section = isBackOfficeSection(requested) ? requested : undefined;
  const outcome = isBackOfficeOutcome(requestedOutcome) ? requestedOutcome : undefined;
  /** The section filter as the URL holds it, kept when the Résultat filter changes. */
  const shownSection = withTools ? TOOLS_FILTER : section;
  const [entries, plans, toolCalls] = await Promise.all([
    getBackOffice().journal({ section, outcome, limit: LIMIT }),
    getBilling().plans(),
    withTools ? latestToolCallsNow(LIMIT, { ok: outcome && toolCallOk(outcome) }) : Promise.resolve([]),
  ]);
  const lines: JournalLine[] = journalTimeline(entries, toolCalls, LIMIT, outcome);
  /** What an entry changed, named as the Back Office names it: a Plan as it is named now; an unknown key stays as recorded. */
  const target = (entry: BackOfficeAuditEntry): string => {
    if (entry.section === "plans" || entry.section === "plan_quotas") return plans.find((plan) => plan.key === entry.target)?.name[locale] ?? entry.target;
    if (entry.section === "job_discovery_sources" && JOB_DISCOVERY_SOURCES.includes(entry.target as JobDiscoverySource)) {
      return t(`admin.searchSites.sources.names.${entry.target as JobDiscoverySource}`);
    }
    if (entry.section === "guardrails" && isGuardrailId(entry.target)) return t(`admin.guardrails.names.${entry.target}`);
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
      <ActivityTabs access={access} shown={TAB} />
      <p className="lead">{t("admin.journal.intro", { years: String(RETENTION_YEARS) })}</p>
      <nav aria-label={t("admin.journal.filter")}>
        <ul className="journal-filter">
          {[undefined, ...BACK_OFFICE_SECTIONS].map((option) => (
            <li key={option ?? "all"}>
              <Link href={routes.adminAudit({ section: option, outcome })} aria-current={option === section && !withTools ? CURRENT : undefined}>
                {option ? t(`admin.journal.sections.${option}`) : t("admin.journal.all")}
              </Link>
            </li>
          ))}
          {readsTools ? (
            <li>
              <Link href={routes.adminAudit({ section: TOOLS_FILTER, outcome })} aria-current={withTools ? CURRENT : undefined}>
                {t("admin.journal.tools")}
              </Link>
            </li>
          ) : null}
        </ul>
      </nav>
      <nav aria-label={t("admin.journal.outcomeFilter")}>
        <ul className="journal-filter">
          {[undefined, ...BACK_OFFICE_OUTCOMES].map((option) => (
            <li key={option ?? "all"}>
              <Link href={routes.adminAudit({ section: shownSection, outcome: option })} aria-current={option === outcome ? CURRENT : undefined}>
                {t(`admin.journal.outcomeFilters.${option ?? "all"}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {withTools ? <p>{t("admin.journal.toolsIntro")}</p> : null}
      {lines.length === 0 ? (
        <p>{t("admin.journal.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t(withTools ? "admin.journal.toolsCaption" : "admin.journal.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.journal.at")}</th>
                <th scope="col">{t("admin.journal.administrator")}</th>
                <th scope="col">{t("admin.journal.section")}</th>
                <th scope="col">{t("admin.journal.target")}</th>
                <th scope="col">{t("admin.journal.action")}</th>
                <th scope="col">{t("admin.journal.outcome")}</th>
                <th scope="col">{t("admin.journal.changes")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                if (line.kind === "tool_call") {
                  const { tool, call } = line;
                  return (
                    <tr key={`call-${call.at.toISOString()}-${index}`} data-kind="tool-call">
                      <th scope="row">
                        <time dateTime={call.at.toISOString()}>{at.format(call.at)}</time>
                      </th>
                      <td>{t("admin.journal.byJobbbox")}</td>
                      <td>{t("admin.journal.tools")}</td>
                      <td>
                        <Link href={routes.adminTool(tool.id)}>{tool.name}</Link>
                      </td>
                      <td>
                        {t("admin.journal.toolCall")} <code>{call.operation}</code>
                      </td>
                      <td>{t(`admin.journal.outcomes.${call.ok ? "succeeded" : "failed"}`)}</td>
                      <td>{callResult(call)}</td>
                    </tr>
                  );
                }
                const { entry } = line;
                const changes = journalChanges(entry.before, entry.after);
                return (
                  <tr key={entry.id}>
                    <th scope="row">
                      <time dateTime={entry.at.toISOString()}>{at.format(entry.at)}</time>
                    </th>
                    <td>
                      {entry.actor.email}
                      {entry.actor.candidateId === null ? ` (${t("admin.journal.accountDeleted")})` : null}
                    </td>
                    <td>{t(`admin.journal.sections.${entry.section}`)}</td>
                    <td>
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
                    </td>
                    <td>{t(`admin.journal.actions.${entry.action}`)}</td>
                    <td>{t(`admin.journal.outcomes.${entry.outcome}`)}</td>
                    <td>
                      {entry.failure ? (
                        <>
                          <p>{t("admin.journal.failed", { tried: t(`admin.journal.actions.${entry.failure.tried}`), reason: t(`failureReasons.${entry.failure.reason}`) })}</p>
                          {entry.failure.field ? <p>{t("admin.journal.fieldAtFault", { field: fieldName(entry.section, entry.failure.field) })}</p> : null}
                          {entry.failure.technical ? (
                            <details className="journal-technical">
                              <summary>{t("admin.journal.technicalDetail")}</summary>
                              <dl>
                                <dt>{t("admin.journal.technical.class")}</dt>
                                <dd>{entry.failure.technical.class}</dd>
                                {entry.failure.technical.provider ? (
                                  <>
                                    <dt>{t("admin.journal.technical.provider")}</dt>
                                    <dd>{entry.failure.technical.provider}</dd>
                                  </>
                                ) : null}
                                {entry.failure.technical.status === undefined ? null : (
                                  <>
                                    <dt>{t("admin.journal.technical.status")}</dt>
                                    <dd>{entry.failure.technical.status}</dd>
                                  </>
                                )}
                                <dt>{t("admin.journal.technical.message")}</dt>
                                <dd>
                                  <code>{entry.failure.technical.message}</code>
                                </dd>
                              </dl>
                            </details>
                          ) : null}
                        </>
                      ) : entry.action === "viewed" || entry.action === "tested" ? null : isSecretAction(entry.action) ? (
                        t(`admin.journal.secret.${entry.action}`)
                      ) : changes.length === 0 ? (
                        t("admin.journal.unchanged")
                      ) : (
                        <ul className="journal-changes">
                          {changes.map((change) => (
                            <li key={change.field ?? ""}>{changeLine(entry, change)}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {withTools ? (
        lines.length === LIMIT ? <p>{t("admin.journal.toolsLimit", { count: String(LIMIT) })}</p> : null
      ) : entries.length === LIMIT ? (
        <p>{t("admin.journal.limit", { count: String(LIMIT) })}</p>
      ) : null}
    </BackOfficeLayout>
  );
}
