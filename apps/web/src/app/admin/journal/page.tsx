import {
  JOB_DIGEST_FREQUENCIES,
  JOB_DISCOVERY_SOURCES,
  LIMITED_QUOTAS,
  PLANS,
  type JobDigestFrequency,
  type JobDiscoverySource,
  type LimitedQuota,
  type Plan,
} from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { isBackOfficeRole } from "@/admin/access";
import { BACK_OFFICE_SECTIONS, isBackOfficeSection, isSecretAction, RETENTION_YEARS, type BackOfficeAuditEntry, type BackOfficeSection, type Recorded } from "@/admin/back-office";
import { journalChanges, type JournalChange } from "@/admin/journal-changes";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** How many entries the Journal shows at most. */
const LIMIT = 200;

/** The Human Coach fields the Human Coaches page already names. */
const HUMAN_COACH_FIELDS = ["name", "email", "bookingUrl", "bio"] as const;
type HumanCoachField = (typeof HUMAN_COACH_FIELDS)[number];

/** The sections recording the sites Jobbbox searches: their entries hold `enabled` and, for Job Sites, `postingPages`. */
const SEARCH_SITES_SECTIONS: readonly BackOfficeSection[] = ["job_discovery_sources", "job_discovery_sites", "job_sites"];

/** `aria-current` of the link to the section being shown. */
const CURRENT = "page";

export async function generateMetadata(): Promise<Metadata> {
  // Metadata renders apart from the page: without this, the 404 shown to
  // non-Administrators would still carry the back office's title.
  await requireBackOffice("audit");
  const t = await getServerT();
  return { title: `${t("admin.journal.title")} · ${t("admin.title")}`, robots: { index: false } };
}

/** Administrators read the Back Office Audit: every change made in the Back Office, newest first, by section. */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { access } = await requireBackOffice("audit");
  const locale = await getRequestLocale();
  const t = await getServerT(locale);
  const requested = (await searchParams).section;
  const section = isBackOfficeSection(requested) ? requested : undefined;
  const entries = await getBackOffice().journal({ section, limit: LIMIT });
  const at = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });
  const number = new Intl.NumberFormat(locale);

  const fieldName = (entrySection: BackOfficeSection, field: string): string => {
    if (entrySection === "plan_quotas" && (LIMITED_QUOTAS.includes(field as LimitedQuota) || field === "jobDigest")) {
      return t(`billing.quotas.${field as LimitedQuota | "jobDigest"}`);
    }
    if (entrySection === "human_coaches" && HUMAN_COACH_FIELDS.includes(field as HumanCoachField)) return t(`admin.humanCoaches.${field as HumanCoachField}`);
    if (entrySection === "roles" && field === "roles") return t("admin.administrators.roles");
    if (SEARCH_SITES_SECTIONS.includes(entrySection) && field === "enabled") return t("admin.searchSites.status");
    if (entrySection === "job_sites" && field === "postingPages") return t("admin.searchSites.jobSites.postingPages");
    if (field === "id") return t("admin.journal.id");
    return field;
  };
  const shown = (entrySection: BackOfficeSection, field: string | null, value: Recorded): string => {
    if (entrySection === "job_sites" && field === "postingPages" && value === null) return t("admin.searchSites.jobSites.anyPostingPage");
    if (SEARCH_SITES_SECTIONS.includes(entrySection) && field === "enabled" && typeof value === "boolean") {
      return t(value ? "admin.searchSites.enabled" : "admin.searchSites.disabled");
    }
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

  /** What an entry changed, named as the Back Office names it. */
  const target = (entry: BackOfficeAuditEntry): string => {
    if (entry.section === "plan_quotas" && PLANS.includes(entry.target as Plan)) return t(`billing.plans.${entry.target as Plan}`);
    if (entry.section === "job_discovery_sources" && JOB_DISCOVERY_SOURCES.includes(entry.target as JobDiscoverySource)) {
      return t(`admin.searchSites.sources.names.${entry.target as JobDiscoverySource}`);
    }
    return entry.target;
  };

  return (
    <BackOfficeLayout access={access}>
      <h1>{t("admin.journal.title")}</h1>
      <p className="lead">{t("admin.journal.intro", { years: String(RETENTION_YEARS) })}</p>
      <nav aria-label={t("admin.journal.filter")}>
        <ul className="journal-filter">
          {[undefined, ...BACK_OFFICE_SECTIONS].map((option) => (
            <li key={option ?? "all"}>
              <Link href={routes.adminJournal(option)} aria-current={option === section ? CURRENT : undefined}>
                {option ? t(`admin.journal.sections.${option}`) : t("admin.journal.all")}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {entries.length === 0 ? (
        <p>{t("admin.journal.none")}</p>
      ) : (
        <div className="table-scroll">
          <table className="application-table">
            <caption>{t("admin.journal.caption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.journal.at")}</th>
                <th scope="col">{t("admin.journal.administrator")}</th>
                <th scope="col">{t("admin.journal.section")}</th>
                <th scope="col">{t("admin.journal.target")}</th>
                <th scope="col">{t("admin.journal.action")}</th>
                <th scope="col">{t("admin.journal.changes")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
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
                    <td>{target(entry)}</td>
                    <td>{t(`admin.journal.actions.${entry.action}`)}</td>
                    <td>
                      {isSecretAction(entry.action) ? (
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
      {entries.length === LIMIT ? <p>{t("admin.journal.limit", { count: String(LIMIT) })}</p> : null}
    </BackOfficeLayout>
  );
}
