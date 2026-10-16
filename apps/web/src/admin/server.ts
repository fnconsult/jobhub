import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { routes } from "@/routes";
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
 * The Administrator signed in on this request, and what they may do, read afresh
 * from the database. Sends anonymous visitors to sign in, and answers 404 to
 * anyone else, so the Back Office stays unseen: to everyone but Administrators,
 * and, with `resource`, to those whose roles do not allow `permission` on it.
 * Every Back Office page and write calls it first.
 */
export async function requireBackOffice(resource?: BackOfficeResource, permission: Permission = "read"): Promise<{ administrator: Person; access: AdministratorAccess }> {
  const person = await getCurrentCandidate();
  if (!person) redirect(routes.signIn);
  const access = await getAdministrators().access(person);
  if (!access.isAdministrator || (resource && !access.can(resource, permission))) notFound();
  return { administrator: { id: person.id, email: person.email, emailVerified: person.emailVerified }, access };
}
