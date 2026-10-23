/**
 * The link filter for Provenance sites (CONTEXT.md, ADR-0034), applied when a Provenance is stored and
 * when it is shown:
 *
 *   provenanceLink(link)   the link as it may be kept and shown, or null when it may not be
 *
 * Kept: an http(s) page, its query string and fragment dropped, or one of the Candidate's own pages inside
 * Jobbbox, as a path. Refused: a LinkedIn profile (ADR-0001) or any person page (`isPersonPage`), an
 * Enriched Contact, any other address inside Jobbbox (the Back Office, a Human Coach's pages, the account,
 * the Candidate's files), a signed or tokenised address, an address with a user and password.
 */
import type { TOOLS } from "./tools";

/** Social networks, where a page is a person's profile; their pages are never a source (LinkedIn's company pages excepted). */
export const PROFILE_HOSTS = ["linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "threads.net", "viadeo.com"] as const;

/** Whether `url` is on a social network and may be a person's profile: anything there but a LinkedIn company page. */
export function isPersonPage(url: URL): boolean {
  const network = PROFILE_HOSTS.find((host) => isOn(url.hostname, host));
  if (!network) return false;
  return !(network === "linkedin.com" && url.pathname.startsWith("/company/"));
}

type ContactEnrichmentTool = Extract<(typeof TOOLS)[number], { category: "contact_enrichment" }>["id"];

/** Where each contact enrichment Tool shows an Enriched Contact: never linked to. */
const ENRICHMENT_HOSTS = { lusha: "lusha.com", kaspr: "kaspr.io", apollo: "apollo.io" } as const satisfies Record<ContactEnrichmentTool, string>;

/** Jobbbox's own domains: an address there is kept only when it is one of the Candidate's own pages. */
const JOBBBOX_DOMAINS = ["jobbbox.ai", "jobbbox.fr", "jobbbox.test", "localhost"];

/** The first path segment of the Candidate's own pages: their Profiles, Applications, Job Searches, Job Offers and Job Digests. */
const OWN_PAGES = new Set(["profils", "candidatures", "recherches", "offres", "job-digests"]);

/** Query parameters that make an address signed or tokenised: the address is refused, not just its query. */
const SIGNED_PARAMETER = /^(x-amz-|x-goog-)|signature|^sig$|token|auth|key|secret|password|session|^code$|expires|hmac|otp/i;

/** A path segment that looks like a token: a long run of letters and digits, or a JSON Web Token. */
const TOKEN_SEGMENT = /[A-Za-z0-9+=]{32,}|eyJ[\w-]+\.[\w-]+/;

const MAX_LENGTH = 2000;

/** A site's domain as a Provenance site names it, e.g. `apec.fr`: a name with a top-level domain, never an IP address. */
export const SITE_DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The site a web link the link filter kept is on, `www.` left out: `apec.fr`. */
export function siteDomainOf(link: string): string {
  return new URL(link).hostname.replace(/^www\./, "");
}

/** The link as a Provenance site may keep and show it, or null when it may not be kept. */
export function provenanceLink(link: string): string | null {
  if (link.length > MAX_LENGTH) return null;
  if (link.startsWith("/") && !link.startsWith("//")) return ownPage(new URL(link, "https://jobbbox.invalid"));
  if (!URL.canParse(link)) return null;
  const url = new URL(link);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (JOBBBOX_DOMAINS.some((domain) => isOn(url.hostname, domain))) return ownPage(url);
  if (!SITE_DOMAIN.test(url.hostname)) return null;
  if (isPersonPage(url) && !isLinkedInOffer(url)) return null;
  if (Object.values(ENRICHMENT_HOSTS).some((host) => isOn(url.hostname, host))) return null;
  if (isTokenised(url)) return null;
  return `${url.origin}${url.pathname}`;
}

/** One of the Candidate's own pages, as a path; null for any other address inside Jobbbox. */
function ownPage(url: URL): string | null {
  const first = url.pathname.split("/")[1] ?? "";
  if (!OWN_PAGES.has(first) || isTokenised(url)) return null;
  return url.pathname;
}

/** A Job Offer the Candidate captured on LinkedIn: its page, never a profile. */
function isLinkedInOffer(url: URL): boolean {
  return isOn(url.hostname, "linkedin.com") && url.pathname.startsWith("/jobs/view/");
}

function isTokenised(url: URL): boolean {
  if ([...url.searchParams.keys()].some((name) => SIGNED_PARAMETER.test(name))) return true;
  return url.pathname.split("/").some((segment) => TOKEN_SEGMENT.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment));
}

/** Whether `hostname` is `domain` or one of its subdomains. */
function isOn(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
