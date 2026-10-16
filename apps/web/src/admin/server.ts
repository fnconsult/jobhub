import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { getBilling } from "@/billing/server";
import { sharedPool } from "@/database/pool";
import { getHumanCoaches } from "@/human-coaches/server";
import { routes } from "@/routes";
import { administratorsFromEnv } from "./access";
import { createBackOffice, type BackOffice } from "./back-office";

const isAdministrator = administratorsFromEnv(process.env);

let backOffice: BackOffice | undefined;

/** The app's Back Office writes and their Back Office Audit, on the database named by DATABASE_URL. */
export function getBackOffice(): BackOffice {
  backOffice ??= createBackOffice(sharedPool(), { billing: getBilling(), humanCoaches: getHumanCoaches() });
  return backOffice;
}

/** Whether the person signed in on this request is an Administrator. */
export async function currentIsAdministrator(): Promise<boolean> {
  const person = await getCurrentCandidate();
  return person ? isAdministrator(person) : false;
}

/**
 * The Administrator signed in on this request. Sends anonymous visitors to
 * sign in, and answers 404 to everyone else, so the back office stays unseen.
 */
export async function requireAdministrator() {
  const person = await getCurrentCandidate();
  if (!person) redirect(routes.signIn);
  if (!isAdministrator(person)) notFound();
  return person;
}
