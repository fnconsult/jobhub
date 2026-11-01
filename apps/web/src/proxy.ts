import { NextResponse, type NextRequest } from "next/server";
import { englishHelpCentrePath, LOCALE_HEADER, urlLocale, VISITOR_LOCALE_HEADER } from "@/i18n/locale-header";
import { maintenanceOf, maintenanceResponse, staysOpen } from "@/maintenance";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { legalRedirect } from "@/public-pages/legal-redirects";
import { REQUEST_PATH_HEADER } from "@/request-path";

/**
 * Every request but Next's static files:
 * - during maintenance (#542), answers 503 to whatever does not stay open (see maintenance), read from the Platform
 *   Settings' per-process cache, never from the database;
 * - redirects for good (308) the addresses of Légal that moved (#546): « IA dans Jobbbox », #470's Legal Documents
 *   and `?version=` (see legalRedirect);
 * - passes the path asked on as REQUEST_PATH_HEADER, so sign-in can bring a signed-out visitor back to it;
 * - on the pages whose language is chosen by their URL's `lang` (the Job Digest unsubscribe page, and the public pages,
 *   #470, #544), passes it on as LOCALE_HEADER, so the root layout's <html lang> matches the page's text; elsewhere, as
 *   VISITOR_LOCALE_HEADER, which only a Visitor's page heeds (an error page under the public site's header);
 * - serves the Help Centre's English addresses, /en/aide/… (#549), from its French ones, in English.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!staysOpen(pathname)) {
    const maintenance = currentMaintenance();
    if (maintenance) return maintenanceResponse(maintenance, pathname, new Date());
  }
  const moved = legalRedirect(pathname, request.nextUrl.searchParams);
  if (moved) return NextResponse.redirect(new URL(moved, request.url), 308);
  const headers = new Headers(request.headers);
  headers.delete(LOCALE_HEADER);
  headers.delete(VISITOR_LOCALE_HEADER);
  headers.set(REQUEST_PATH_HEADER, `${pathname}${search}`);
  const french = englishHelpCentrePath(pathname);
  if (french) {
    // Served from the French address, in English; the FR/EN switch and the header's links read it as `?lang=en`.
    const params = new URLSearchParams(search);
    params.set("lang", "en");
    headers.set(LOCALE_HEADER, "en");
    headers.set(REQUEST_PATH_HEADER, `${french}?${params.toString()}`);
    const target = request.nextUrl.clone();
    target.pathname = french;
    return NextResponse.rewrite(target, { request: { headers } });
  }
  const { chosen, visitor } = urlLocale(pathname, request.nextUrl.searchParams.get("lang"));
  if (chosen) headers.set(LOCALE_HEADER, chosen);
  if (visitor) headers.set(VISITOR_LOCALE_HEADER, visitor);
  return NextResponse.next({ request: { headers } });
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
