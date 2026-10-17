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
  /** The Back Office Audit (the Journal). */
  audit: ["read"],
  planQuotas: ["read", "write"],
  /** Plans and their per-Plan features. */
  plans: ["read", "write"],
  humanCoaches: ["read", "write"],
  coachMessageCost: ["read"],
  providerSecrets: ["read", "write"],
  ssoProviders: ["read", "write"],
  /** The sites Jobbbox searches: Job discovery sources and sites, and the extension's Job Sites. */
  searchSites: ["read", "write"],
} as const satisfies Record<string, readonly Permission[]>;

export type BackOfficeResource = keyof typeof statements;

const control = createAccessControl(statements);

/** The Back Office Roles, as stored in `administrator_role.role`. */
export const BACK_OFFICE_ROLES = ["super-admin", "plans-manager", "coach-manager", "support"] as const;
export type BackOfficeRole = (typeof BACK_OFFICE_ROLES)[number];

export const isBackOfficeRole = (value: unknown): value is BackOfficeRole => BACK_OFFICE_ROLES.includes(value as BackOfficeRole);

const READ = ["read"] as const;

const ROLES = {
  "super-admin": control.newRole(statements),
  "plans-manager": control.newRole({ plans: ["read", "write"], planQuotas: ["read", "write"] }),
  "coach-manager": control.newRole({ humanCoaches: ["read", "write"], coachMessageCost: READ }),
  // Reads everything but Provider Secrets; the team's own sections (Administrateurs, Journal) stay with super-admins.
  support: control.newRole({ planQuotas: READ, plans: READ, humanCoaches: READ, coachMessageCost: READ, ssoProviders: READ, searchSites: READ }),
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
