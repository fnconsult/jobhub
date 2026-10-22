import { LIMITED_QUOTAS, type LimitedQuota } from "@jobhub/shared";
import type { TFunction } from "i18next";
import type { BackOfficeSection } from "./back-office";

/** The Human Coach fields the Human Coaches page already names. */
const HUMAN_COACH_FIELDS = ["name", "email", "bookingUrl", "bio"] as const;
type HumanCoachField = (typeof HUMAN_COACH_FIELDS)[number];

/** The sections recording the sites Jobbbox searches: their entries hold `enabled` and, for Job Sites, `postingPages`. */
export const SEARCH_SITES_SECTIONS: readonly BackOfficeSection[] = ["job_discovery_sources", "job_discovery_sites", "job_sites"];

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
/** A Sign-in Provider's secrets, as the Connexion form labels them: one a refusal can be about (an Apple key that does not sign). */
const SIGN_IN_SECRET_FIELDS = ["clientSecret", "teamId", "keyId", "privateKey"] as const;
type SignInSecretField = (typeof SIGN_IN_SECRET_FIELDS)[number];

/** A Plan's recorded fields, by the Plans page's label for each. */
export const PLAN_FIELDS = ["name", "status", "stripeProductId", "features", "rank", "quotas"] as const;
type PlanField = (typeof PLAN_FIELDS)[number];

/** A Playbook Version's recorded fields (#225), each with its label. */
const PLAYBOOK_FIELDS = ["version", "provider", "model", "effort", "consultWhen", "rulesCharacters", "validatedBy", "validatedAt", "archived"] as const;
type PlaybookField = (typeof PLAYBOOK_FIELDS)[number];

/** An Eval Case's recorded fields (#231), each with its label. */
const EVAL_CASE_FIELDS = ["caseId", "title", "context", "message", "inViewKind", "inViewText", "criteria"] as const;
type EvalCaseField = (typeof EVAL_CASE_FIELDS)[number];

/** A Guardrail's recorded fields (#228): its setting, or a Guardrail message's language, version, text and validation. */
const GUARDRAIL_FIELDS = ["setting", "language", "version", "text", "validatedBy", "validatedAt"] as const;
type GuardrailField = (typeof GUARDRAIL_FIELDS)[number];

/** A Coupon's recorded fields, by the Codes promo page's label for each. */
const COUPON_FIELDS = ["code", "discount", "duration", "plans", "expiresAt", "maxRedemptions", "firstPaymentOnly", "active"] as const;
type CouponField = (typeof COUPON_FIELDS)[number];

/**
 * A recorded field of a `section` entry (a change, or the field at fault in a failure), named as the
 * Back Office page it was changed on names it. A field no page names stays as recorded.
 */
export function journalFieldName(t: TFunction, section: BackOfficeSection, field: string): string {
  if (section === "plan_quotas" && (LIMITED_QUOTAS.includes(field as LimitedQuota) || field === "jobDigest")) {
    return t(`billing.quotas.${field as LimitedQuota | "jobDigest"}`);
  }
  if (section === "plan_quotas" && (field === "reason" || field === "candidates")) return t(`admin.planQuotas.reset.journalFields.${field}`);
  if (section === "human_coaches" && HUMAN_COACH_FIELDS.includes(field as HumanCoachField)) return t(`admin.humanCoaches.${field as HumanCoachField}`);
  if (section === "roles" && field === "roles") return t("admin.administrators.roles");
  if (section === "roles" && field === "email") return t("admin.administrators.email");
  if (SEARCH_SITES_SECTIONS.includes(section) && field === "enabled") return t("admin.searchSites.status");
  if (section === "job_sites" && field === "postingPages") return t("admin.searchSites.jobSites.postingPages");
  if (section === "plans" && PLAN_FIELDS.includes(field as PlanField)) return t(`admin.plans.fields.${field as PlanField}`);
  if (section === "coupons" && COUPON_FIELDS.includes(field as CouponField)) return t(`admin.coupons.fields.${field as CouponField}`);
  if (section === "sign_in_providers" && field in SIGN_IN_PROVIDER_FIELDS) {
    return t(`admin.signInProviders.${SIGN_IN_PROVIDER_FIELDS[field as keyof typeof SIGN_IN_PROVIDER_FIELDS]}`);
  }
  if (section === "sign_in_providers" && SIGN_IN_SECRET_FIELDS.includes(field as SignInSecretField)) return t(`admin.signInProviders.fields.${field as SignInSecretField}`);
  if (section === "coaching_playbooks" && PLAYBOOK_FIELDS.includes(field as PlaybookField)) return t(`admin.coachingPlaybooks.journalFields.${field as PlaybookField}`);
  if (section === "guardrails" && GUARDRAIL_FIELDS.includes(field as GuardrailField)) return t(`admin.guardrails.journalFields.${field as GuardrailField}`);
  if (section === "eval_cases" && EVAL_CASE_FIELDS.includes(field as EvalCaseField)) return t(`admin.evals.journalFields.${field as EvalCaseField}`);
  if (section === "provider_secrets" && field === "value") return t("admin.journal.value");
  if (section === "platform_settings" && (field === "value" || field === "source")) return t(`admin.platformSettings.journalFields.${field}`);
  if (field === "id") return t("admin.journal.id");
  return field;
}
