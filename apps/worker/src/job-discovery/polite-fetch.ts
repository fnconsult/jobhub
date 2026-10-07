/**
 * Fetching a page the way ADR-0002 allows: robots.txt first, as ourselves,
 * and giving up (never working around it) at the first sign of bot protection.
 */
import { robotsAllow } from "./robots";

/** Why a page was not read. */
export type RefusalReason =
  /** robots.txt (or the page's own robots meta tag) asks crawlers to stay out. */
  | "robots"
  /** The site's terms of use forbid crawling it; only the browser extension covers it. */
  | "site_terms"
  /** A CAPTCHA, Cloudflare challenge or similar anti-bot check. */
  | "bot_protection"
  /** The page needs the visitor to sign in. */
  | "login_wall"
  /** Not a public web page (private network address, unusual scheme). */
  | "not_public"
  /** Down, missing, too slow, too large or not HTML. */
  | "unreachable";

export type PageResult = { ok: true; url: string; html: string } | { ok: false; reason: RefusalReason };

export interface PoliteFetchOptions {
  fetch: typeof globalThis.fetch;
  userAgent: string;
  /** Hosts (and their subdomains) whose terms of use forbid crawling. */
  forbiddenSites: readonly string[];
  timeoutMs: number;
  maxBytes: number;
}

const MAX_REDIRECTS = 5;

const CHALLENGE_MARKERS = [
  /challenges\.cloudflare\.com/i,
  /cf-turnstile/i,
  /_cf_chl_opt/i,
  /<title>\s*(just a moment|attention required|un instant)/i,
  /g-recaptcha|recaptcha\/api\.js/i,
  /h-captcha|hcaptcha\.com/i,
  /captcha-delivery\.com|datadome/i,
  /px-captcha|perimeterx/i,
  /<title>[^<]*captcha/i,
];

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|connexion|se-connecter|auth|authentification|sso)(\/|$|\?|\.)/i;

/** Hosts we must never reach from the server: loopback, private and link-local networks, internal names. */
function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (!host.includes(".") && !host.includes(":")) return false;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  if (host.includes(":")) {
    return !(host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
  }
  return true;
}

function isForbidden(hostname: string, forbiddenSites: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return forbiddenSites.some((site) => host === site || host.endsWith(`.${site}`));
}

function looksLikeChallenge(response: Response, body: string): boolean {
  if ((response.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge") return true;
  return CHALLENGE_MARKERS.some((marker) => marker.test(body));
}

function looksLikeLoginWall(url: URL, body: string): boolean {
  if (LOGIN_PATH.test(url.pathname)) return true;
  return /<input\b[^>]*type\s*=\s*["']?password/i.test(body);
}

async function readText(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** A fetcher for one discovery run: robots.txt is read once per site. */
export function createPoliteFetcher(options: PoliteFetchOptions) {
  const robotsBySite = new Map<string, Promise<string | null>>();

  const request = (url: URL | string, redirect: "follow" | "manual") =>
    options.fetch(String(url), {
      redirect,
      headers: { "user-agent": options.userAgent, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(options.timeoutMs),
    });

  /** robots.txt for the site, "" when it has none, or null when it cannot be read (then nothing is allowed). */
  const robotsFor = (origin: string): Promise<string | null> => {
    let robots = robotsBySite.get(origin);
    if (!robots) {
      robots = (async () => {
        try {
          const response = await request(`${origin}/robots.txt`, "follow");
          if (response.ok) return (await readText(response, 512 * 1024)) ?? null;
          // RFC 9309: a missing robots.txt (4xx) allows everything; a server error means "stay out" for now.
          if (response.status >= 400 && response.status < 500 && response.status !== 429) return "";
          return null;
        } catch {
          return null;
        }
      })();
      robotsBySite.set(origin, robots);
    }
    return robots;
  };

  /** Whether we may request this URL at all, before sending anything to its site. */
  const mayRequest = async (url: URL): Promise<RefusalReason | null> => {
    if (url.protocol !== "https:" && url.protocol !== "http:") return "not_public";
    if (url.username || url.password || !isPublicHost(url.hostname)) return "not_public";
    if (isForbidden(url.hostname, options.forbiddenSites)) return "site_terms";
    const robots = await robotsFor(url.origin);
    if (robots === null || !robotsAllow(robots, options.userAgent, `${url.pathname}${url.search}`)) return "robots";
    return null;
  };

  return {
    async page(address: string): Promise<PageResult> {
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        return { ok: false, reason: "not_public" };
      }
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const refusal = await mayRequest(url);
        if (refusal) return { ok: false, reason: refusal };

        let response: Response;
        try {
          response = await request(url, "manual");
        } catch {
          return { ok: false, reason: "unreachable" };
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (!location) return { ok: false, reason: "unreachable" };
          url = new URL(location, url);
          if (LOGIN_PATH.test(url.pathname)) return { ok: false, reason: "login_wall" };
          continue;
        }

        const body = await readText(response, options.maxBytes).catch(() => null);
        if (body === null) return { ok: false, reason: "unreachable" };
        if (looksLikeChallenge(response, body)) return { ok: false, reason: "bot_protection" };
        if (response.status === 401 || (response.status === 403 && looksLikeLoginWall(url, body))) return { ok: false, reason: "login_wall" };
        if (!response.ok) return { ok: false, reason: "unreachable" };
        if (!/html/i.test(response.headers.get("content-type") ?? "")) return { ok: false, reason: "unreachable" };
        if (looksLikeLoginWall(url, body)) return { ok: false, reason: "login_wall" };
        return { ok: true, url: url.toString(), html: body };
      }
      return { ok: false, reason: "unreachable" };
    },
  };
}
