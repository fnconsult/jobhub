/**
 * Types shared by the AI layer and its provider adapters (ADR-0007).
 * Callers only need `AiLayer`; `AiProvider` is the seam each adapter fills.
 */

export const PROVIDER_IDS = ["anthropic", "mistral", "openai", "perplexity", "brave", "tavily", "linkup"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * What a text call is for. Each task is routed to a provider by configuration.
 * Whether a task carries personal data is fixed here, in code, so configuration can never loosen it.
 */
export const TEXT_TASKS = {
  /** Match Score, ATS Score, ATS Fixes: reads CVs. */
  scoring: { personalData: true },
  /** Tailored Documents, Follow-ups: reads CVs, Profiles, Applications. */
  writing: { personalData: true },
  /** AI Coach conversation: reads everything about the Candidate. */
  coaching: { personalData: true },
  /** Reading an uploaded CV into a structured Master CV: reads CVs. */
  cv_parsing: { personalData: true },
  /** Extracting structured fields from a Job Offer: public posting text only. */
  offer_analysis: { personalData: false },
  /** Job title variants for a Job Search's queries: given the Search Criteria title alone. */
  job_titles: { personalData: false },
} as const satisfies Record<string, { personalData: boolean }>;
export type TextTask = keyof typeof TEXT_TASKS;

/** The web-search task. Only ever receives a query built from Search Criteria, or from an employer's name for a Company Dossier. */
export const SEARCH_TASK = "web_search";
export type SearchTask = typeof SEARCH_TASK;
export type AiTask = TextTask | SearchTask;

/**
 * The tokens of one AI call. `inputTokens` is the input not read from the provider's prompt cache
 * (it includes any input written to the cache); cached input is counted apart, as it is priced apart.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input read from the provider's prompt cache. Absent or 0 when nothing was. */
  cachedInputTokens?: number;
  /** How many of `inputTokens` were written to the provider's prompt cache (Anthropic only). */
  cacheWriteTokens?: number;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Where a provider endpoint processes data. Personal data may only go to "eu". */
export type Residency = "eu" | "outside_eu";

export interface TextInput {
  model?: string;
  system?: string;
  messages: Message[];
  maxTokens: number;
}

export interface TextOutput {
  text: string;
  model: string;
  usage: TokenUsage;
}

export interface SearchOutput {
  answer: string;
  sources: string[];
  model: string;
  usage: TokenUsage;
}

/**
 * Narrows a web search. Each provider applies what its API offers and ignores the rest,
 * so callers still check every result (e.g. ADR-0002's forbidden sites).
 * Never built from a Profile or CV: like the query, it is not personal data.
 */
export interface SearchFilters {
  /** Only pages on these sites (domain names such as "apec.fr"). */
  includeDomains?: string[];
  /** No pages on these sites. */
  excludeDomains?: string[];
  /** Only pages published within this many days. */
  maxAgeDays?: number;
  /** Favour pages from this country (ISO 3166-1 alpha-2, e.g. "FR"): a preference, not a restriction. */
  country?: string;
}

export interface SearchOptions {
  model?: string;
  filters?: SearchFilters;
  /** Which page of results, from 1 (the default) up to the provider's `searchPages`. */
  page?: number;
}

/** The seam every provider adapter fills. */
export interface AiProvider {
  readonly id: ProviderId;
  /** Human-readable endpoint, e.g. "bedrock eu-west-3"; used in errors and logs. */
  readonly endpoint: string;
  readonly residency: Residency;
  generate?(input: TextInput): Promise<TextOutput>;
  search?(query: string, options: SearchOptions): Promise<SearchOutput>;
  /** How many pages of results `search` can give one query (see `SearchOptions.page`). Default: 1. */
  readonly searchPages?: number;
}

export interface UsageEntry extends TokenUsage {
  /** null for a Guest (browser extension without an account). */
  candidateId: string | null;
  task: AiTask;
  provider: ProviderId;
  endpoint: string;
  model: string;
  at: Date;
}

/** Where every AI call's token usage goes (feeds Plan Quotas). */
export interface UsageLog {
  record(entry: UsageEntry): void | Promise<void>;
}
