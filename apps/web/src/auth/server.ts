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

/**
 * Whether a state-changing request comes from the web app itself (or our
 * extension), not from another site riding on the Candidate's session cookie.
 */
export function isFromTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const { baseURL, trustedOrigins } = getAuth().options;
  const trusted = [new URL(String(baseURL)).origin, ...(Array.isArray(trustedOrigins) ? trustedOrigins : [])];
  return trusted.includes(origin);
}
