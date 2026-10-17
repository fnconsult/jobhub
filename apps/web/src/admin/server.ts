import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate, getCurrentSession } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { routes } from "@/routes";
import { needsSsoForBackOffice } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";
import { permanentSuperAdminsFromEnv, type BackOfficeResource, type Permission } from "./access";
import { createAdministrators, type AdministratorAccess, type Administrators, type Person } from "./administrators";
import { createBackOffice, type BackOffice } from "./back-office";

let backOffice: BackOffice | undefined;
let administrators: Administrators | undefined;

/** The app's Back Office writes and their Back Office Audit, on the database named by DATABASE_URL. */
export function getBackOffice(): BackOffice {
  backOffice ??= createBackOffice(sharedPool(), { billing: getBilling(), humanCoaches: getHumanCoaches() });
  return backOffice;
}

/** The app's Administrators and their Back Office Roles; ADMIN_EMAILS names the permanent super-admins. */
export function getAdministrators(): Administrators {
  administrators ??= createAdministrators(sharedPool(), { backOffice: getBackOffice(), isPermanentSuperAdmin: permanentSuperAdminsFromEnv(process.env) });
  return administrators;
}

/** Whether the person signed in on this request is an Administrator (holds any Back Office Role). */
export async function currentIsAdministrator(): Promise<boolean> {
  const person = await getCurrentCandidate();
  return person ? (await getAdministrators().access(person)).isAdministrator : false;
}

/**
 * Where the person on this request stands with the Back Office, read afresh: not signed in,
 * signed in with no Back Office Role, an Administrator whom Require SSO for Administrators
 * asks to sign in again with a provider allowed for them (signed in by magic link; never an
 * ADMIN_EMAILS super-admin), or one the Back Office lets in. The one place this is decided.
 */
async function backOfficeStanding(): Promise<
  | { state: "anonymous" }
  | { state: "not_administrator" }
  | { state: "needs_sso" | "signed_in"; person: Person; access: AdministratorAccess }
> {
  const current = await getCurrentSession();
  if (!current) return { state: "anonymous" };
  const access = await getAdministrators().access(current.user);
  if (!access.isAdministrator) return { state: "not_administrator" };
  const needsSso = needsSsoForBackOffice(currentSignInConfiguration(), { signInMethod: current.session.signInMethod ?? null, permanentSuperAdmin: access.permanent });
  const { id, email, emailVerified } = current.user;
  return { state: needsSso ? "needs_sso" : "signed_in", person: { id, email, emailVerified }, access };
}

/** Where the person on the Back Office sign-in page stands (see backOfficeStanding). */
export async function backOfficeSignInState(): Promise<"anonymous" | "not_administrator" | "needs_sso" | "signed_in"> {
  return (await backOfficeStanding()).state;
}

/**
 * For the Back Office's API routes: the Administrator signed in on this request (their Candidate id) and what
 * they may do, read afresh from the database; null for anyone else (signed out, with no
 * Back Office Role, or signed in by magic link while Require SSO for Administrators asks for
 * a provider), whom the route answers 404, so the Back Office stays unseen.
 */
export async function backOfficeAdministrator(): Promise<{ id: string; access: AdministratorAccess } | null> {
  const standing = await backOfficeStanding();
  return standing.state === "signed_in" ? { id: standing.person.id, access: standing.access } : null;
}

/**
 * The Administrator signed in on this request, and what they may do, read afresh
 * from the database. Sends anonymous visitors to sign in, and answers 404 to
 * anyone else, so the Back Office stays unseen: to everyone but Administrators,
 * and, with `resource`, to those whose roles do not allow `permission` on it.
 * With Require SSO for Administrators on, an Administrator signed in by magic link is
 * sent to the Back Office sign-in to sign in again with a provider allowed for them
 * (ADMIN_EMAILS super-admins excepted); their Candidate pages are untouched.
 * Every Back Office page and write calls it first.
 */
export async function requireBackOffice(
  resource?: BackOfficeResource,
  permission: Permission = "read",
): Promise<{ administrator: Person; access: AdministratorAccess; /** Whether their roles also let them change `resource`. */ canWrite: boolean }> {
  const standing = await backOfficeStanding();
  if (standing.state === "anonymous" || standing.state === "needs_sso") redirect(routes.backOfficeSignIn);
  if (standing.state === "not_administrator") notFound();
  const { person: administrator, access } = standing;
  if (resource && !access.can(resource, permission)) notFound();
  return {
    administrator,
    access,
    canWrite: resource ? access.can(resource, "write") : false,
  };
}
