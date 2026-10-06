/**
 * Types shared by the AI layer and its provider adapters (ADR-0007).
 * Callers only need `AiLayer`; `AiProvider` is the seam each adapter fills.
 */

export const PROVIDER_IDS = ["anthropic", "mistral", "openai", "perplexity"] as const;
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
  /** Extracting structured fields from a Job Offer: public posting text only. */
  offer_analysis: { personalData: false },
} as const satisfies Record<string, { personalData: boolean }>;
export type TextTask = keyof typeof TEXT_TASKS;

/** The web-search task. Only ever receives a query built from Search Criteria. */
export const SEARCH_TASK = "web_search";
export type SearchTask = typeof SEARCH_TASK;
export type AiTask = TextTask | SearchTask;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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

/** The seam every provider adapter fills. */
export interface AiProvider {
  readonly id: ProviderId;
  /** Human-readable endpoint, e.g. "bedrock eu-west-3"; used in errors and logs. */
  readonly endpoint: string;
  readonly residency: Residency;
  generate?(input: TextInput): Promise<TextOutput>;
  search?(query: string, options: { model?: string }): Promise<SearchOutput>;
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
