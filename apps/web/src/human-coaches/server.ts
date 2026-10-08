import { notFound, redirect } from "next/navigation";
import { Pool } from "pg";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate } from "@/auth/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { getTailoredCvs } from "@/tailored-cv/server";
import { getTailoredDocuments } from "@/tailored-documents/server";
import { createHumanCoaches, type HumanCoach, type HumanCoaches } from "./index";

let instance: HumanCoaches | undefined;

/** The app's Human Coaches module, on the database named by DATABASE_URL. */
export function getHumanCoaches(): HumanCoaches {
  instance ??= createHumanCoaches(new Pool({ connectionString: process.env.DATABASE_URL }), {
    profiles: getProfiles(),
    applications: getApplications(),
    tailoredDocuments: getTailoredDocuments(),
    tailoredCvs: getTailoredCvs(),
  });
  return instance;
}

/** The Human Coach signed in on this request, or null. */
export async function currentHumanCoach(): Promise<HumanCoach | null> {
  const person = await getCurrentCandidate();
  return person ? getHumanCoaches().coachSignedIn(person) : null;
}

/**
 * The Human Coach signed in on this request, for the coach space. Sends
 * anonymous visitors to sign in, and answers 404 to everyone else.
 */
export async function requireHumanCoach(): Promise<HumanCoach> {
  const person = await getCurrentCandidate();
  if (!person) redirect(routes.signIn);
  const coach = await getHumanCoaches().coachSignedIn(person);
  if (!coach) notFound();
  return coach;
}
