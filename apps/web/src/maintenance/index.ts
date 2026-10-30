/**
 * Maintenance (#542): super-admins switch it on in the Back Office's Paramètres (Environnement tab), with an optional
 * message in each language and how long it should last. While it is on, `src/proxy.ts` answers every request it does
 * not let through with a 503 and `Retry-After`: a bilingual page, or JSON under `/api`. The page is self-contained
 * (inline styles from the tokens, no React, no session), so it never depends on what may be down.
 */
import { designTokens } from "@jobhub/shared/design";
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
 * sign-in, the health check, the webhooks other services call (Stripe, Brevo's inbound emails), and Next's assets.
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

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
  const { color, fontFamily } = designTokens;
  const section = (locale: "fr" | "en") => {
    const copy = COPY[locale];
    const returns = maintenance.returnsAt ? `<p class="meta">${escape(copy.returns(returnTime(maintenance.returnsAt, locale)))}</p>` : "";
    const message = maintenance.message[locale] ? `<p>${escape(maintenance.message[locale])}</p>` : "";
    return `<section lang="${locale}"><h1>${copy.title}</h1><p>${copy.text}</p>${message}${returns}</section>`;
  };
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Maintenance · Jobbbox</title>
<style>
:root{--bg:${color.background.light};--text:${color.text.light};--secondary:${color.secondary.light};--border:${color.border.light};--accent:${color.accent.light};--on-accent:${color.onAccent.light}}
@media (prefers-color-scheme: dark){:root{--bg:${color.background.dark};--text:${color.text.dark};--secondary:${color.secondary.dark};--border:${color.border.dark};--accent:${color.accent.dark};--on-accent:${color.onAccent.dark}}}
body{margin:0;background:var(--bg);color:var(--text);font-family:${fontFamily.sans};font-size:1.125rem;line-height:1.6}
main{max-width:36rem;margin:0 auto;padding:4rem 1rem}
.wordmark{margin:0 0 2.5rem;font-size:1.25rem;font-weight:700;letter-spacing:-0.02em}
.code{margin:0;color:var(--secondary);font-size:2.5rem;font-weight:300;font-variant-numeric:tabular-nums}
h1{margin:.5rem 0;font-size:1.5rem;font-weight:500;line-height:1.3}
p{margin:0 0 .75rem}
.meta{color:var(--secondary)}
section+section{margin-top:2rem;padding-top:2rem;border-top:1px solid var(--border)}
a{display:inline-block;margin-top:2rem;padding:.625rem 1.25rem;border-radius:999px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:500}
</style>
</head>
<body>
<main>
<p class="wordmark">Jobbbox</p>
<p class="code" aria-hidden="true">503</p>
${section("fr")}
${section("en")}
<a href="">${COPY.fr.retry} · ${COPY.en.retry}</a>
</main>
</body>
</html>
`;
}

/** The 503 answer to `path`: JSON under `/api`, the page elsewhere; never cached, never indexed. */
export function maintenanceResponse(maintenance: Maintenance, path: string, now: Date): Response {
  const headers = { "Retry-After": String(retryAfterSeconds(maintenance, now)), "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (path === "/api" || path.startsWith("/api/")) {
    return Response.json({ error: "maintenance", returnsAt: maintenance.returnsAt?.toISOString() ?? null }, { status: 503, headers });
  }
  return new Response(maintenancePage(maintenance), { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
