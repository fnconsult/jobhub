import { notFound, redirect } from "next/navigation";
import { Pool } from "pg";
import { getCurrentCandidate } from "@/auth/server";
import { routes } from "@/routes";
import { createProfiles, type Profile, type Profiles } from "./index";

let instance: Profiles | undefined;

/** The app's Profiles module, on the database named by DATABASE_URL. */
export function getProfiles(): Profiles {
  instance ??= createProfiles(new Pool({ connectionString: process.env.DATABASE_URL }));
  return instance;
}

/**
 * For a Profile's pages: the signed-in Candidate and their Profile `id`.
 * Sends anonymous visitors to sign in, and answers 404 for a Profile that is not theirs.
 */
export async function requireOwnProfile(id: string): Promise<{ candidateId: string; profile: Profile }> {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const profile = await getProfiles().get(candidate.id, id);
  if (!profile) notFound();
  return { candidateId: candidate.id, profile };
}
