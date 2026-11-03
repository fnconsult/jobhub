/**
 * The Exit Page: every link to a site outside Jobbbox goes through it, and it tells the person they are leaving
 * Jobbbox, for which site, before taking them there. This module holds what both sides need: which links are
 * external, the address of the Exit Page for one of them, and the destination an Exit Page may take a person to.
 */

/** The shell an Exit Page is drawn in: the role's, as for an error page (#542). */
export type ExitShell = "site" | "backOffice" | "coachSpace";

/** The Exit Page of each shell. */
export const EXIT_PATHS = { site: "/sortie", backOffice: "/admin/sortie", coachSpace: "/espace-coach/sortie" } as const satisfies Record<ExitShell, string>;

/** The query parameter holding the destination. */
export const EXIT_PARAMETER = "url";

/** How long the Exit Page waits before taking the person on, when they came from a page of Jobbbox. */
export const EXIT_DELAY_SECONDS = 5;

/** The longest destination an Exit Page accepts. */
const MAX_LENGTH = 2048;

/** Whether `href` leads outside Jobbbox: an absolute `http:` or `https:` address. A path, an anchor, `mailto:` or `tel:` stay. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href.trim());
}

/** The shell of the page at `pathname`: the Back Office under `/admin`, the coach space under `/espace-coach`, else the site. */
export function exitShellOf(pathname: string): ExitShell {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "backOffice";
  if (pathname === "/espace-coach" || pathname.startsWith("/espace-coach/")) return "coachSpace";
  return "site";
}

/**
 * The Exit Page for `href` from the page at `pathname`, in that page's shell; `lang` keeps a Visitor's language
 * (English) on the site's, which is not a public page served under `/en`. `href` itself when it does not leave Jobbbox.
 */
export function exitHref(href: string, pathname: string, lang?: string): string {
  if (!isExternalHref(href)) return href;
  const shell = exitShellOf(pathname);
  const params = new URLSearchParams({ [EXIT_PARAMETER]: href.trim() });
  if (shell === "site" && lang === "en") params.set("lang", "en");
  return `${EXIT_PATHS[shell]}?${params.toString()}`;
}

/**
 * Where an Exit Page may take the person: its `url` parameter, when it is one absolute `http:` or `https:` address,
 * without a user name or a password (`https://jobbbox.ai@other.example` hides its real host), and not overly long.
 * Null otherwise, and the Exit Page is not found.
 */
export function exitDestination(value: string | string[] | undefined): URL | null {
  if (typeof value !== "string" || value.length > MAX_LENGTH || !isExternalHref(value)) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url;
}

/** The site an Exit Page names: the destination's host, without `www.`. */
export function exitSite(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

/**
 * Whether the Exit Page may take the person on by itself: only when they came from a page of Jobbbox (`referrer`,
 * same `origin`). Reached from anywhere else (a link in an email, a message, another site), it waits for a click,
 * so its address cannot send someone elsewhere unawares under Jobbbox's name.
 */
export function exitRedirectsBySelf(referrer: string, origin: string): boolean {
  if (!referrer) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}
