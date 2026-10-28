/**
 * Back Office Roles (ADR-0014 addendum #193): what each role may read and change,
 * as code constants declared with Better Auth's access-control plugin. Who holds
 * which role lives in `administrator_role` (see administrators.ts); this module
 * only answers what a set of roles allows, and who the permanent super-admins are.
 */
import { createAccessControl } from "better-auth/plugins/access";

type Env = Record<string, string | undefined>;

/** What a role may do to a resource: see it, or change it. */
export type Permission = "read" | "write";

/** Every part of the Back Office a role can cover. */
const statements = {
  /** Administrators and their Back Office Roles (the Administrateurs section). */
  roles: ["read", "write"],
  /** The Back Office Audit (Activité › Actions des administrateurs). */
  audit: ["read"],
  /** Every run of Job discovery, its searches and Discovery metrics (Activité › Recherches, #404): no Candidate named. */
  discoveryRuns: ["read"],
  /** Every Received offer email of Email intake, its outcome and Guardrail verdict (Activité › Emails reçus, #449, ADR-0051): no Candidate named, never content. */
  receivedEmails: ["read"],
  /** The Job Search behind a run, opened from Activité › Recherches: the Candidate's own data, every opening audited (#404). */
  jobSearches: ["read"],
  planQuotas: ["read", "write"],
  /** Plans and their per-Plan features. */
  plans: ["read", "write"],
  /** Coupons: Stripe promotion codes on Plans. */
  coupons: ["read", "write"],
  humanCoaches: ["read", "write"],
  coachMessageCost: ["read"],
  providerSecrets: ["read", "write"],
  /** The Platform Settings (Paramètres, #298, ADR-0033): non-secret settings, shown with their source; write covers changing and restoring them. */
  platformSettings: ["read", "write"],
  ssoProviders: ["read", "write"],
  /** The sites Jobbbox searches: Job discovery sources and sites, and the extension's Job Sites. */
  searchSites: ["read", "write"],
  /** The AI consumption report (Consommation IA): aggregates, read-only. */
  aiUsage: ["read"],
  /** The AI Message Log (Activité › Appels IA): what AI calls said, personal data; every read is audited. */
  aiMessages: ["read"],
  /** The Coaching Playbooks, the Core Digest and the Sources list (#225): write covers creating, versioning, validating and archiving. */
  coachingPlaybooks: ["read", "write"],
  /** The Guardrails (#228): read covers their Guardrail Triggers; write covers settings and Guardrail messages, validation included. */
  guardrails: ["read", "write"],
  /** The Tools (Outils, #233): the external tools the app calls, their state and their calls; read-only, never a payload or a secret. */
  tools: ["read"],
  /** Eval Runs (#231, ADR-0023): write covers starting one, whose AI calls cost; a Guardrail setting's needs `guardrails` write too. */
  evalRuns: ["read", "write"],
  /** Unanswered Questions (« Questions sans réponse », #344): write covers marking one « Article écrit » or « Écarter ». */
  unansweredQuestions: ["read", "write"],
  /**
   * Signalements (#376): write covers changing their status and replying. Read alone (Help editors) shows only the
   * Questions, without the Candidate's email or Plan; nobody deletes one from the Back Office.
   */
  signalements: ["read", "write"],
} as const satisfies Record<string, readonly Permission[]>;

export type BackOfficeResource = keyof typeof statements;

const control = createAccessControl(statements);

/** The Back Office Roles, as stored in `administrator_role.role`. */
export const BACK_OFFICE_ROLES = ["super-admin", "plans-manager", "coach-manager", "playbook-editor", "help-editor", "platform-manager", "support"] as const;
export type BackOfficeRole = (typeof BACK_OFFICE_ROLES)[number];

export const isBackOfficeRole = (value: unknown): value is BackOfficeRole => BACK_OFFICE_ROLES.includes(value as BackOfficeRole);

const READ = ["read"] as const;

const ROLES = {
  "super-admin": control.newRole(statements),
  "plans-manager": control.newRole({ plans: ["read", "write"], planQuotas: ["read", "write"], coupons: ["read", "write"] }),
  "coach-manager": control.newRole({ humanCoaches: ["read", "write"], coachMessageCost: READ }),
  "playbook-editor": control.newRole({ coachingPlaybooks: ["read", "write"], evalRuns: ["read", "write"] }),
  "help-editor": control.newRole({ unansweredQuestions: ["read", "write"], signalements: READ }),
  // « Technique » (#397, ADR-0042): changes every non-secret setting of Paramètres (the Tools' prices among them), the
  // Job discovery sources and sites and the Job Sites; sees Provider Secrets by their source and last 4 characters only,
  // never replaces one; reads what the Dashboard sums up, the Back Office Audit, the Job discovery runs and the Emails reçus. Never the AI Message Log.
  "platform-manager": control.newRole({
    platformSettings: ["read", "write"],
    searchSites: ["read", "write"],
    providerSecrets: READ,
    ssoProviders: READ,
    tools: READ,
    aiUsage: READ,
    audit: READ,
    discoveryRuns: READ,
    receivedEmails: READ,
  }),
  // Reads everything but Provider Secrets, the AI Message Log and the Job Search behind a run, and triages Signalements; the team's own
  // sections (Administrateurs, Actions des administrateurs) stay with super-admins.
  support: control.newRole({
    planQuotas: READ,
    plans: READ,
    coupons: READ,
    humanCoaches: READ,
    coachMessageCost: READ,
    ssoProviders: READ,
    aiUsage: READ,
    searchSites: READ,
    coachingPlaybooks: READ,
    guardrails: READ,
    tools: READ,
    evalRuns: READ,
    platformSettings: READ,
    unansweredQuestions: READ,
    signalements: ["read", "write"],
    discoveryRuns: READ,
    receivedEmails: READ,
  }),
} satisfies Record<BackOfficeRole, unknown>;

/** What one Administrator may do in the Back Office, from the roles they hold. */
export interface BackOfficeAccess {
  roles: readonly BackOfficeRole[];
  /** Holds at least one role: may enter the Back Office. */
  isAdministrator: boolean;
  isSuperAdmin: boolean;
  /** Whether one of the roles allows `permission` on `resource`. */
  can(resource: BackOfficeResource, permission: Permission): boolean;
}

export function backOfficeAccess(roles: readonly BackOfficeRole[]): BackOfficeAccess {
  const held = BACK_OFFICE_ROLES.filter((role) => roles.includes(role));
  return {
    roles: held,
    isAdministrator: held.length > 0,
    isSuperAdmin: held.includes("super-admin"),
    can: (resource, permission) => held.some((role) => ROLES[role].authorize({ [resource]: [permission] }).success),
  };
}

/** Whether a person is a permanent super-admin, and their addresses. */
export type PermanentSuperAdmins = ((person: { email: string; emailVerified: boolean }) => boolean) & {
  /** Their email addresses, lower case. */
  emails: readonly string[];
};

/**
 * Permanent super-admins: the Jobbbox team members whose email addresses are listed in
 * ADMIN_EMAILS (ADR-0014), with a verified email. Nobody can revoke them from the app,
 * so the team can never be locked out.
 */
export function permanentSuperAdminsFromEnv(env: Env): PermanentSuperAdmins {
  const emails = new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const isPermanent = (person: { email: string; emailVerified: boolean }): boolean => person.emailVerified && emails.has(person.email.trim().toLowerCase());
  return Object.assign(isPermanent, { emails: [...emails] });
}
