import { NextResponse, type NextRequest } from "next/server";
import { ENGLISH_PREFIX, LOCALE_HEADER, splitLocalePrefix, URL_LOCALE_HEADER, urlLocale, VISITOR_LOCALE_HEADER } from "@/i18n/locale-header";
import { maintenanceOf, maintenanceResponse, staysOpen } from "@/maintenance";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { legalRedirect } from "@/public-pages/legal-redirects";
import { betaRobotsHeader } from "@/public-pages/indexing";
import { currentRelease } from "@/release";
import { REQUEST_PATH_HEADER } from "@/request-path";

/**
 * Every request but Next's static files:
 * - during maintenance (#542), answers 503 to whatever does not stay open (see maintenance), read from the Platform
 *   Settings' per-process cache, never from the database;
 * - redirects for good (308) the addresses of Légal that moved (#546): « IA dans Jobbbox », #470's Legal Documents
 *   and `?version=` (see legalRedirect);
 * - passes the path asked on as REQUEST_PATH_HEADER, so sign-in can bring a signed-out visitor back to it;
 * - serves a public page under `/en` (#545) in English, with the same French slug: `/en/legal/cgu` is `/legal/cgu`,
 *   its language passed on as VISITOR_LOCALE_HEADER (a signed-in Candidate's Interface Language comes first, #501);
 * - on the public pages, passes their URL's `lang` on as LOCALE_HEADER, so the root layout's <html lang> matches the
 *   page's text; elsewhere, as VISITOR_LOCALE_HEADER, which only a Visitor's page heeds (an error page under the
 *   public site's header); and the URL's own language as URL_LOCALE_HEADER, which the shell's links and `hreflang` follow
 *   (the Help Centre's English addresses, /en/aide/…, #549, included);
 * - on the Beta, says `X-Robots-Tag: noindex` on every answer (#545): nothing of it is indexed.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const prefixed = splitLocalePrefix(pathname);
  if (!staysOpen(pathname)) {
    const maintenance = currentMaintenance();
    if (maintenance) return maintenanceResponse(maintenance, pathname, new Date());
  }
  const moved = legalRedirect(prefixed.pathname, request.nextUrl.searchParams);
  if (moved) return noindexOnBeta(NextResponse.redirect(new URL(prefixed.pathname === pathname ? moved : `${ENGLISH_PREFIX}${moved}`, request.url), 308));
  const headers = new Headers(request.headers);
  for (const header of [LOCALE_HEADER, VISITOR_LOCALE_HEADER, URL_LOCALE_HEADER]) headers.delete(header);
  headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  const { rewrite, chosen, visitor, url } = urlLocale(pathname, request.nextUrl.searchParams.get("lang"));
  if (chosen) headers.set(LOCALE_HEADER, chosen);
  if (visitor) headers.set(VISITOR_LOCALE_HEADER, visitor);
  if (url) headers.set(URL_LOCALE_HEADER, url);
  if (!rewrite) return noindexOnBeta(NextResponse.next({ request: { headers } }));
  const target = request.nextUrl.clone();
  target.pathname = rewrite;
  return noindexOnBeta(NextResponse.rewrite(target, { request: { headers } }));
}

const BETA_ROBOTS = betaRobotsHeader(currentRelease(process.env).beta);

/** On the Beta (anything but Production), the answer says `X-Robots-Tag: noindex` (maintenance's 503 says it too). */
function noindexOnBeta(response: NextResponse): NextResponse {
  if (BETA_ROBOTS) response.headers.set("X-Robots-Tag", BETA_ROBOTS);
  return response;
}

/** Maintenance as Paramètres sets it; never fails a request: unreadable settings let it through. */
function currentMaintenance() {
  try {
    return maintenanceOf(getPlatformSettingsResolver().current());
  } catch (error) {
    console.error("[maintenance] the Platform Settings could not be read", error);
    return null;
  }
}

export const config = {
  // Everything but Next's static files and images (the matcher must be a literal).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
