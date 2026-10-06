import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { authConfigFromEnv } from "./config";
import { createAuth, type Auth } from "./index";

let instance: Auth | undefined;

/** The app's Candidate-accounts module, configured from the environment on first use. */
export function getAuth(): Auth {
  instance ??= createAuth(authConfigFromEnv(process.env));
  return instance;
}

/** The Candidate signed in on this request, or null. Never touches the database for anonymous visitors. */
export async function getCurrentCandidate() {
  const requestHeaders = await headers();
  if (!getSessionCookie(requestHeaders)) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  return session?.user ?? null;
}
