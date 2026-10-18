/**
 * Perplexity: web search only (ADR-0002, ADR-0007). It has no text generation on purpose.
 * Speaks Perplexity's Agent API (`POST /v1/responses`); its chat-completions endpoint is retired.
 * Filters go on the `web_search` tool (docs/research/issue-112.md): domains, a recency window, a country.
 */
import { parseStatedDate } from "@jobhub/shared";
import { AiProviderError } from "../errors";
import type { AiProvider, SearchFilters, SearchOutput, ToolCall } from "../types";
import { postJson } from "./http";
import { domainsOf } from "./web-results";

/** The parts of an Agent API response a search needs. */
interface AgentResponse {
  status?: string;
  model?: string;
  error?: { message?: string } | null;
  output?: (
    /** `date`: when the page was published (`last_updated` is not that, and is ignored). */
    | { type: "search_results"; status?: string; error?: unknown; results?: { url?: string; date?: string | null }[] }
    /** A page the model fetched (the fetch_url tool); `status` says whether it worked, when present. */
    | { type: "fetch_url_results"; status?: string; error?: unknown }
    | { type: "message"; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[] }
    | { type: string }
  )[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Perplexity's preset: its cheapest web-search setup. A configured model replaces only the preset's model. */
const PRESET = "fast";
/** The model the "fast" preset runs. */
const PRESET_MODEL = "openai/gpt-6-luna";
/** Room for an answer listing offers; also required by Perplexity for `anthropic/*` models. */
const MAX_OUTPUT_TOKENS = 2048;
/** Perplexity's most entries in a domain filter. */
const MAX_DOMAINS = 20;
/** Results per page. Perplexity has no offset: page n asks for n pages' worth (its most is 50). */
const PAGE_SIZE = 10;
const PAGES = 5;
/** Perplexity's recency windows, narrowest first, with their length in days. */
const RECENCY: [days: number, window: string][] = [
  [1, "day"],
  [7, "week"],
  [31, "month"],
  [366, "year"],
];

export interface PerplexityProviderOptions {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
}

export function createPerplexityProvider(options: PerplexityProviderOptions): AiProvider {
  const client = { provider: "perplexity" as const, apiKey: options.apiKey, fetch: options.fetch };
  return {
    id: "perplexity",
    // The "fast" preset's model (docs/research/issue-74.md).
    defaultModel: PRESET_MODEL,
    endpoint: "api.perplexity.ai",
    residency: "outside_eu",
    searchPages: PAGES,
    async search(query, { model, filters, page }): Promise<SearchOutput> {
      const response = await postJson<AgentResponse>(client, "https://api.perplexity.ai/v1/responses", {
        preset: PRESET,
        ...(model ? { model } : {}),
        input: query,
        tools: [webSearchTool(filters, page)],
        max_output_tokens: MAX_OUTPUT_TOKENS,
        store: false,
      });
      if (response?.status !== "completed") {
        const reason = response?.error?.message ?? `status ${response?.status ?? "missing"}`;
        throw new AiProviderError("perplexity", `search did not complete: ${reason}`, 200);
      }
      return searchOutputOf(response);
    },
  };
}

/** The `web_search` tool, with what Perplexity applies of the filters, and the results the page needs. */
function webSearchTool(filters: SearchFilters | undefined, page = 1): Record<string, unknown> {
  // Included and excluded domains cannot be mixed: the narrower, included ones win.
  const included = domainsOf(filters?.includeDomains);
  const domains = included ?? domainsOf(filters?.excludeDomains)?.map((domain) => `-${domain}`);
  const days = filters?.maxAgeDays;
  const recency = typeof days === "number" && days > 0 ? RECENCY.find(([within]) => days <= within)?.[1] : undefined;
  const country = filters?.country?.trim().toUpperCase();
  const tool: Record<string, unknown> = { type: "web_search" };
  if (domains || recency) {
    tool.filters = {
      ...(domains ? { search_domain_filter: domains.slice(0, MAX_DOMAINS) } : {}),
      ...(recency ? { search_recency_filter: recency } : {}),
    };
  }
  if (country) tool.user_location = { country };
  if (page > 1) tool.max_results = Math.min(page, PAGES) * PAGE_SIZE;
  return tool;
}

function searchOutputOf(response: AgentResponse): SearchOutput {
  const answer: string[] = [];
  const found: string[] = [];
  const cited: string[] = [];
  const sourceDates: Record<string, Date> = {};
  // Each block of search results is one use of the web_search tool, which Perplexity bills per search;
  // each block of fetched pages, one use of fetch_url.
  const tools = new ToolTally();
  for (const item of response.output ?? []) {
    if (item.type === "search_results") tools.add("web_search", item);
    if (item.type === "fetch_url_results") tools.add("fetch_url", item);
    if (item.type === "search_results" && "results" in item) {
      for (const result of item.results ?? []) {
        if (!result.url) continue;
        found.push(result.url);
        const published = parseStatedDate(result.date);
        if (published) sourceDates[result.url] = published;
      }
    }
    if (item.type === "message" && "content" in item) {
      for (const part of item.content ?? []) {
        if (part.type !== "output_text") continue;
        answer.push(part.text ?? "");
        for (const annotation of part.annotations ?? []) if (annotation.type === "url_citation" && annotation.url) cited.push(annotation.url);
      }
    }
  }
  return {
    answer: answer.join(""),
    sources: [...new Set([...found, ...cited])],
    ...(Object.keys(sourceDates).length ? { sourceDates } : {}),
    model: response.model ?? "unknown",
    usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 },
    tools: tools.calls(),
  };
}

/** Tool blocks counted per tool and outcome; an outcome is known when the block has a `status` or an `error`. */
class ToolTally {
  private readonly counts = new Map<string, ToolCall>();

  add(name: string, block: { type: string; status?: unknown; error?: unknown }) {
    const ok = block.error ? false : typeof block.status === "string" ? block.status === "completed" : undefined;
    const key = `${name} ${ok}`;
    const tool = this.counts.get(key) ?? { name, count: 0, ...(ok === undefined ? {} : { ok }) };
    tool.count += 1;
    this.counts.set(key, tool);
  }

  /** The tools used, web_search first: at least one search, as the call is one. */
  calls(): ToolCall[] {
    const calls = [...this.counts.values()];
    if (!calls.some((tool) => tool.name === "web_search")) calls.unshift({ name: "web_search", count: 1 });
    return calls.sort((a, b) => Number(b.name === "web_search") - Number(a.name === "web_search"));
  }
}
