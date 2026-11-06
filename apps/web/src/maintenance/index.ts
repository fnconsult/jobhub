/**
 * Maintenance (#542): super-admins switch it on in the Back Office's Paramètres (Environnement tab), with an optional
 * message in each language and how long it should last. While it is on, `src/proxy.ts` answers every request it does
 * not let through with a 503 and `Retry-After`: a bilingual page, or JSON under `/api`. The page is self-contained
 * (inline styles from the tokens, no React, no session), so it never depends on what may be down.
 */
import { escapeHtml, selfContainedPage } from "../design/self-contained-page";
import type { PlatformSettingsSnapshot } from "../platform-settings/resolver";

export const MAINTENANCE_MODE = "MAINTENANCE_MODE";
export const MAINTENANCE_MESSAGE_FR = "MAINTENANCE_MESSAGE_FR";
export const MAINTENANCE_MESSAGE_EN = "MAINTENANCE_MESSAGE_EN";
export const MAINTENANCE_EXPECTED_MINUTES = "MAINTENANCE_EXPECTED_MINUTES";

/** What a client is told to wait when no return time is known: ten minutes. */
const DEFAULT_RETRY_SECONDS = 600;
/** The shortest wait asked, once the expected return time has passed: a minute. */
const MIN_RETRY_SECONDS = 60;

export interface Maintenance {
  /** The super-admin's message in each language; empty: the standard text only. */
  message: { fr: string; en: string };
  /** When it should end: switched on plus the expected minutes; null when unknown. */
  returnsAt: Date | null;
}

/** Maintenance as Paramètres sets it, or null when it is off. */
export function maintenanceOf(snapshot: PlatformSettingsSnapshot): Maintenance | null {
  const mode = snapshot.setting(MAINTENANCE_MODE);
  if (mode?.value !== "true") return null;
  const minutes = Number(snapshot.setting(MAINTENANCE_EXPECTED_MINUTES)?.value);
  const since = mode.updatedAt;
  return {
    message: { fr: snapshot.setting(MAINTENANCE_MESSAGE_FR)?.value.trim() ?? "", en: snapshot.setting(MAINTENANCE_MESSAGE_EN)?.value.trim() ?? "" },
    returnsAt: since && minutes > 0 ? new Date(since.getTime() + minutes * 60_000) : null,
  };
}

/**
 * What stays open during maintenance: the Back Office and its API (so Administrators can check and switch it off),
 * sign-in, the health check, the webhooks other services call (Stripe, Email intake's MTA), and Next's assets.
 */
const OPEN_PREFIXES = ["/admin", "/api/admin", "/api/auth", "/api/health", "/api/billing/webhook", "/api/email-intake/inbound", "/_next"];

export function staysOpen(path: string): boolean {
  return OPEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** The seconds `Retry-After` asks to wait: until the expected return, at least a minute. */
export function retryAfterSeconds(maintenance: Maintenance, now: Date): number {
  if (!maintenance.returnsAt) return DEFAULT_RETRY_SECONDS;
  return Math.max(MIN_RETRY_SECONDS, Math.ceil((maintenance.returnsAt.getTime() - now.getTime()) / 1000));
}

const escape = escapeHtml;

/** « vers 14 h 30 » / "around 2:30 PM", Paris time: the platform's users are in France. */
function returnTime(at: Date, locale: "fr" | "en"): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Paris" }).format(at);
}

const COPY = {
  fr: {
    title: "Jobbbox est en maintenance",
    text: "Nous améliorons le service. Vos données sont en sécurité et rien n'est perdu. Revenez dans quelques minutes.",
    returns: (time: string) => `Retour prévu vers ${time}.`,
    retry: "Réessayer",
  },
  en: {
    title: "Jobbbox is under maintenance",
    text: "We are improving the service. Your data is safe and nothing is lost. Please come back in a few minutes.",
    returns: (time: string) => `Expected back around ${time}.`,
    retry: "Try again",
  },
} as const;

/** The 503 page: French first (it is authoritative), English under it, in both themes. */
export function maintenancePage(maintenance: Maintenance): string {
  const section = (locale: "fr" | "en") => {
    const copy = COPY[locale];
    const returns = maintenance.returnsAt ? `<p class="meta">${escape(copy.returns(returnTime(maintenance.returnsAt, locale)))}</p>` : "";
    const message = maintenance.message[locale] ? `<p>${escape(maintenance.message[locale])}</p>` : "";
    return { lang: locale, html: `<h1>${copy.title}</h1><p>${copy.text}</p>${message}${returns}` };
  };
  return selfContainedPage({
    lang: "fr",
    title: "Maintenance · Jobbbox",
    code: 503,
    sections: [section("fr"), section("en")],
    action: `${COPY.fr.retry} · ${COPY.en.retry}`,
  });
}

/** The 503 answer to `path`: JSON under `/api`, the page elsewhere; never cached, never indexed. */
export function maintenanceResponse(maintenance: Maintenance, path: string, now: Date): Response {
  const headers = { "Retry-After": String(retryAfterSeconds(maintenance, now)), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (path === "/api" || path.startsWith("/api/")) {
    return Response.json({ error: "maintenance", returnsAt: maintenance.returnsAt?.toISOString() ?? null }, { status: 503, headers });
  }
  return new Response(maintenancePage(maintenance), { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
