import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@jobhub/shared/i18n";

export type CandidateSession =
  | { signedIn: true; candidate: { email: string; name: string; interfaceLanguage: Locale } }
  | { signedIn: false };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The Candidate signed in on the web app, if any. The extension holds no
 * session of its own: its host permission on the web app lets the browser's
 * session cookie travel with this request, so signing in (or out) on the web
 * app signs the extension in (or out) too.
 */
export async function readCandidateSession(webOrigin: string, fetchImpl: Fetch = fetch): Promise<CandidateSession> {
  try {
    const response = await fetchImpl(`${webOrigin}/api/auth/get-session`, { credentials: "include" });
    if (!response.ok) return { signedIn: false };
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
