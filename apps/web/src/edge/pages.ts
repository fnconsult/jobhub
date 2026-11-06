/**
 * The pages the proxy answers with while the web app does not (ADR-0094): Jobbbox's error page for a 502, a 503 or a
 * 504, self-contained, written once into deploy/edge/pages by `npm run edge-pages -w @jobhub/web` and served by the
 * `edge` container of deploy/compose.yml. The VPS's Traefik sends a browser there when no web container is routed
 * (stopped, starting or unhealthy, during a deploy or after a crash: a 503), and when the routed one does not answer
 * (a 502, a 504). Each page reloads itself every 15 seconds, so the person lands on the page they asked for once the
 * app is back. Both languages, the URL's first: English under `/en` or with `?lang=en`, French otherwise (nginx picks
 * the file, deploy/edge/nginx.conf).
 */
import { createI18n } from "@jobhub/shared/i18n";
import { escapeHtml, selfContainedPage } from "../design/self-contained-page";

export const EDGE_CODES = [502, 503, 504] as const;
export type EdgeCode = (typeof EDGE_CODES)[number];
export const EDGE_LOCALES = ["fr", "en"] as const;
export type EdgeLocale = (typeof EDGE_LOCALES)[number];

/** Seconds before the page reloads itself: a deploy's gap lasts about a minute. */
export const EDGE_RELOAD_SECONDS = 15;

const COPY = Object.fromEntries(
  EDGE_LOCALES.map((locale) => {
    const t = createI18n(locale).t;
    return [
      locale,
      {
        title: t("errorPage.unavailable.title"),
        text: t("errorPage.unavailable.message"),
        reload: t("errorPage.unavailable.reload", { seconds: EDGE_RELOAD_SECONDS }),
        retry: t("errorPage.actions.retry"),
      },
    ];
  }),
) as Record<EdgeLocale, { title: string; text: string; reload: string; retry: string }>;

/** The page for `code`, `first`'s language first. */
export function edgePage(code: EdgeCode, first: EdgeLocale): string {
  const order: EdgeLocale[] = first === "fr" ? ["fr", "en"] : ["en", "fr"];
  return selfContainedPage({
    lang: first,
    title: `${escapeHtml(COPY[first].title)} · Jobbbox`,
    code,
    head: `<meta http-equiv="refresh" content="${EDGE_RELOAD_SECONDS}">\n`,
    sections: order.map((lang) => ({ lang, html: `<h1>${escapeHtml(COPY[lang].title)}</h1><p>${escapeHtml(COPY[lang].text)}</p><p class="meta">${escapeHtml(COPY[lang].reload)}</p>` })),
    action: order.map((lang) => escapeHtml(COPY[lang].retry)).join(" · "),
  });
}

/** Every file of deploy/edge/pages, by name: `<code>.<locale>.html`. */
export function edgePageFiles(): Record<string, string> {
  return Object.fromEntries(EDGE_CODES.flatMap((code) => EDGE_LOCALES.map((locale) => [`${code}.${locale}.html`, edgePage(code, locale)])));
}
