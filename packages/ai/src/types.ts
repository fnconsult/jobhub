/**
 * Types shared by the AI layer and its provider adapters (ADR-0007).
 * Callers only need `AiLayer`; `AiProvider` is the seam each adapter fills.
 */
import type { Effort } from "./effort";

export const PROVIDER_IDS = ["anthropic", "mistral", "openai", "perplexity", "brave", "tavily", "linkup"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * What a text call is for. Each task is routed to a provider by configuration.
 * Whether a task carries personal data is noted here, for information: its default route prefers an
 * EU-resident endpoint (env.ts). No task is refused an endpoint for it any more: every call is redacted
 * before it leaves (redaction.ts, ADR-0007 amendment of 2026-10-20).
 */
export const TEXT_TASKS = {
  /** Match Score, ATS Score, ATS Fixes: reads CVs. */
  scoring: { personalData: true },
  /** Tailored Documents, Follow-ups: reads CVs, Profiles, Applications. */
  writing: { personalData: true },
  /** AI Coach conversation: reads everything about the Candidate. */
  coaching: { personalData: true },
  /** The Back Office Assistant: what an Administrator types, and Back Office data (#205, #218). */
  back_office_assistant: { personalData: true },
  /** Guardrail checks (#228, ADR-0022): what a Candidate or Administrator typed, and the AI Coach's or Back Office Assistant's reply. */
  guardrail: { personalData: true },
  /** Reading an uploaded CV into a structured Master CV: reads CVs. */
  cv_parsing: { personalData: true },
  /** Extracting structured fields from a Job Offer: public posting text only. */
  offer_analysis: { personalData: false },
  /** Job title variants for a Job Search's queries: given the Search Criteria title alone. */
  job_titles: { personalData: false },
} as const satisfies Record<string, { personalData: boolean }>;
export type TextTask = keyof typeof TEXT_TASKS;

/** The web-search task. Only ever receives a query built from Search Criteria, or from an employer's names and website for a Company Dossier and its Company News. */
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

/** Where a provider endpoint processes data; shown in the Back Office, and required "eu" of the identity route (EU AI consent). */
export type Residency = "eu" | "outside_eu";

export interface TextInput {
  model?: string;
  system?: string;
  messages: Message[];
  maxTokens: number;
  /** How hard the model should think (#225); each adapter translates it, or leaves it out for a model that has no such setting (see effort.ts). */
  effort?: Effort;
}

/** A tool the model used during one call (e.g. its web search), as the provider reports it. Never its arguments or results. */
export interface ToolCall {
  name: string;
  /** How many times the model used it in the call. */
  count: number;
  /** Whether those uses succeeded, when the provider says. Default: they did. */
  ok?: boolean;
}

export interface TextOutput {
  text: string;
  model: string;
  usage: TokenUsage;
  /** The tools the model used, when the provider says. Default: none. */
  tools?: ToolCall[];
}

export interface SearchOutput {
  answer: string;
  sources: string[];
  /**
   * The date the provider states for some sources (by URL): when it says the page was
   * published, which may be when it was last updated. Absent when it dates none.
   */
  sourceDates?: Record<string, Date>;
  model: string;
  usage: TokenUsage;
  /** How many web searches the call made, when the provider says. Default: one `web_search`. */
  tools?: ToolCall[];
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
  /** The model it uses when the route names none, by name: what a failed call is recorded with. */
  readonly defaultModel?: string;
  /** The text models it offers a Playbook Agent (#225), by the name this endpoint knows them by, its default model first. */
  readonly models?: readonly string[];
  generate?(input: TextInput): Promise<TextOutput>;
  search?(query: string, options: SearchOptions): Promise<SearchOutput>;
  /** How many pages of results `search` can give one query (see `SearchOptions.page`). Default: 1. */
  readonly searchPages?: number;
}

/** A tool use as recorded: how often, whether the call succeeded, how long the call took, and its fee when billed. */
export interface ToolUse extends ToolCall {
  ok: boolean;
  durationMs: number;
  /** Estimated € at list price; null when the provider's fee for it is not known. */
  costEur: number | null;
}

/**
 * What one call said: its system text, messages and reply (null when it failed); for a web search,
 * the query as the one message and the answer. Personal data: only the AI Message Log keeps it.
 */
export interface Transcript {
  system?: string;
  messages: Message[];
  reply: string | null;
}

export interface UsageEntry extends TokenUsage {
  /** null for a Guest (browser extension without an account). */
  candidateId: string | null;
  task: AiTask;
  provider: ProviderId;
  endpoint: string;
  /** The model that answered; for a failed call, the route's model, else the provider's default model (or its id when it names none). */
  model: string;
  /** Whether the provider answered. A failed call is recorded too, with no tokens. */
  ok: boolean;
  /** How long the provider took to answer or fail. */
  durationMs: number;
  /** The tokens' estimated € at list price (`costInEur`); the tools' fees are apart, in `tools`. */
  costEur: number;
  /** The tools the call used. */
  tools: ToolUse[];
  /** What the call said. A usage log that is not the AI Message Log must leave it out. */
  transcript: Transcript;
  at: Date;
}

/**
 * Where every AI call's usage goes (feeds Plan Quotas and AI Usage). The AI layer does not wait
 * for `record`: a log that throws, rejects or is slow never fails nor delays the call.
 */
export interface UsageLog {
  record(entry: UsageEntry): void | Promise<void>;
}
