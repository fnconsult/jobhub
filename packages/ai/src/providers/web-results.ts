/**
 * What the search-only providers (Brave, Tavily, Linkup) have in common: they return
 * a ranked list of pages, not a written answer. Each page becomes a source, and the
 * answer lists them (title, URL, snippet) so callers reading the answer see the same pages.
 */
import type { SearchFilters, SearchOutput } from "../types";

export interface WebResult {
  title?: string;
  url?: string;
  snippet?: string;
}

/** Search-only providers bill per request, not per token. */
const NO_TOKENS = { inputTokens: 0, outputTokens: 0 };

export function searchOutputOfResults(results: WebResult[], model: string): SearchOutput {
  const seen = new Set<string>();
  const kept: Required<WebResult>[] = [];
  for (const result of results) {
    const url = result.url?.trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    kept.push({ title: result.title?.trim() ?? "", url, snippet: result.snippet?.trim() ?? "" });
  }
  return {
    answer: kept.map((r) => [r.title, r.url, r.snippet].filter(Boolean).join("\n")).join("\n\n"),
    sources: kept.map((r) => r.url),
    model,
    usage: NO_TOKENS,
  };
}

/** The non-empty domain list of a filter, or undefined when there is none. */
export function domainsOf(domains: string[] | undefined): string[] | undefined {
  const kept = (domains ?? []).map((d) => d.trim()).filter(Boolean);
  return kept.length ? kept : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first day (YYYY-MM-DD, UTC) of the freshness window, or undefined when there is none. */
export function sinceDateOf(filters: SearchFilters | undefined, now: Date): string | undefined {
  const days = filters?.maxAgeDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return undefined;
  return isoDay(new Date(now.getTime() - days * DAY_MS));
}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
