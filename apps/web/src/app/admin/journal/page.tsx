import {
  JOB_DIGEST_FREQUENCIES,
  JOB_DISCOVERY_SOURCES,
  LIMITED_QUOTAS,
  PLAN_FEATURES,
  PLAN_STATUSES,
  type JobDigestFrequency,
  type JobDiscoverySource,
  type LimitedQuota,
  type PlanFeature,
  type PlanStatus,
} from "@jobhub/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { isBackOfficeRole } from "@/admin/access";
import { BACK_OFFICE_SECTIONS, isBackOfficeSection, isSecretAction, RETENTION_YEARS, type BackOfficeAuditEntry, type BackOfficeSection, type Recorded } from "@/admin/back-office";
import { journalChanges, type JournalChange } from "@/admin/journal-changes";
import { getBackOffice, requireBackOffice } from "@/admin/server";
import { couponDiscountLabel } from "@/billing/coupon-label";
import { getBilling } from "@/billing/server";
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
/** A Sign-in Provider's recorded fields, by the Connexion page's label for each. */
const SIGN_IN_PROVIDER_FIELDS = {
  type: "type",
  displayName: "displayName",
  clientId: "clientId",
  discoveryUrl: "discoveryUrl",
  tenantId: "tenantId",
  appBundleIdentifier: "appBundleIdentifier",
  enabled: "enabledLabel",
  shownToCandidates: "shownToCandidatesLabel",
  allowedForAdministrators: "allowedForAdministratorsLabel",
  trustedForLinking: "trustedLabel",
  secretsReplaced: "secrets",
} as const;

/** A Plan's recorded fields, by the Plans page's label for each. */
const PLAN_FIELDS = ["name", "status", "stripeProductId", "features", "rank", "quotas"] as const;
type PlanField = (typeof PLAN_FIELDS)[number];

/** A Coupon's recorded fields, by the Codes promo page's label for each. */
const COUPON_FIELDS = ["code", "discount", "duration", "plans", "expiresAt", "maxRedemptions", "firstPaymentOnly", "active"] as const;
type CouponField = (typeof COUPON_FIELDS)[number];

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
  const [entries, plans] = await Promise.all([getBackOffice().journal({ section, limit: LIMIT }), getBilling().plans()]);
  /** What an entry changed, named as the Back Office names it: a Plan as it is named now; an unknown key stays as recorded. */
  const target = (entry: BackOfficeAuditEntry): string => {
    if (entry.section === "plans" || entry.section === "plan_quotas") return plans.find((plan) => plan.key === entry.target)?.name[locale] ?? entry.target;
    if (entry.section === "job_discovery_sources" && JOB_DISCOVERY_SOURCES.includes(entry.target as JobDiscoverySource)) {
      return t(`admin.searchSites.sources.names.${entry.target as JobDiscoverySource}`);
    }
    return entry.target;
  };
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
    if (entrySection === "plans" && PLAN_FIELDS.includes(field as PlanField)) return t(`admin.plans.fields.${field as PlanField}`);
    if (entrySection === "coupons" && COUPON_FIELDS.includes(field as CouponField)) return t(`admin.coupons.fields.${field as CouponField}`);
    if (entrySection === "sign_in_providers" && field in SIGN_IN_PROVIDER_FIELDS) {
      return t(`admin.signInProviders.${SIGN_IN_PROVIDER_FIELDS[field as keyof typeof SIGN_IN_PROVIDER_FIELDS]}`);
    }
    if (field === "id") return t("admin.journal.id");
    return field;
  };
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
