import { isSupportedLocale, DEFAULT_LOCALE, type Locale } from "@jobhub/shared/i18n";
import { getAuth } from "@/auth/server";
import { routes } from "@/routes";

/**
 * The Candidate behind a form posted from our own subscription page, or null.
 * Refuses posts from other origins (on top of SameSite session cookies).
 */
export async function candidatePosting(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== new URL(request.url).origin && origin !== process.env.APP_URL) return null;
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return null;
  const language: unknown = session.user.interfaceLanguage;
  const locale: Locale = isSupportedLocale(language) ? language : DEFAULT_LOCALE;
  return { id: session.user.id, email: session.user.email, locale };
}

/** 303 See Other: the browser follows with a GET, as after any form post. */
export function seeOther(location: string, request: Request) {
  return Response.redirect(new URL(location, process.env.APP_URL ?? request.url), 303);
}

export const subscriptionPage = (query = "") => `${routes.subscription}${query}`;
