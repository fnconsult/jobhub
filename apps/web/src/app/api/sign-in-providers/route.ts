import type { SignInProvidersResponse } from "@jobhub/shared";
import { signInButtons } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";

/**
 * The Sign-in Providers shown to Candidates (#687), as the web's sign-in page reads them (connexion/page.tsx): what the
 * app's sign-in screen offers beside the magic link. Public, like that page; their ids and names alone. Never cached: a
 * provider switched off in Connexion is gone from the app's screen at its next read.
 */
export function GET() {
  const answer: SignInProvidersResponse = { providers: signInButtons(currentSignInConfiguration(), "candidates") };
  return Response.json(answer, { headers: { "Cache-Control": "no-store" } });
}
