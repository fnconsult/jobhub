import { notFound, redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { routes } from "@/routes";
import { administratorsFromEnv } from "./access";

const isAdministrator = administratorsFromEnv(process.env);

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
