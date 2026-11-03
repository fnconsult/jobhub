import { SECOND_STEP_REQUIRED } from "@jobhub/shared";
import { API_VERSION_HEADERS } from "./extension-update";
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";

export type CandidateSession =
  | { signedIn: true; candidate: { email: string; name: string; interfaceLanguage: Locale } }
  /** `secondStepPending`: signed in by magic link, the second step not done yet (ADR-0075): the panel sends them to finish it. */
  | { signedIn: false; secondStepPending?: true };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The Candidate signed in on the web app, if any. The extension holds no
 * session of its own: its host permission on the web app lets the browser's
 * session cookie travel with this request, so signing in (or out) on the web
 * app signs the extension in (or out) too.
 */
export async function readCandidateSession(webOrigin: string, fetchImpl: Fetch = fetch): Promise<CandidateSession> {
  try {
    const response = await fetchImpl(`${webOrigin}/api/auth/get-session`, { headers: API_VERSION_HEADERS, credentials: "include" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      return response.status === 401 && body?.error === SECOND_STEP_REQUIRED ? { signedIn: false, secondStepPending: true } : { signedIn: false };
    }
    const body = (await response.json()) as { user?: Record<string, unknown> } | null;
    const user = body?.user;
    if (!user || typeof user.email !== "string") return { signedIn: false };
    return {
      signedIn: true,
      candidate: {
        email: user.email,
        name: typeof user.name === "string" ? user.name : "",
        interfaceLanguage: isSupportedLocale(user.interfaceLanguage) ? user.interfaceLanguage : DEFAULT_LOCALE,
      },
    };
  } catch {
    return { signedIn: false };
  }
}
