/**
 * Types shared by the AI layer and its provider adapters (ADR-0007).
 * Callers only need `AiLayer`; `AiProvider` is the seam each adapter fills.
 */
import type { AiUsageProvider, FailureReason, Outcome, TechnicalReason } from "@jobhub/shared";
import type { Effort } from "./effort";

/** Each a registered Tool's (TOOLS, #233): a provider not registered does not type-check. */
export const PROVIDER_IDS = ["anthropic", "mistral", "openai", "perplexity", "brave", "tavily"] as const satisfies readonly AiUsageProvider[];
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * What a text call is for. Each task is routed to a provider by configuration.
 * Whether a task carries personal data is noted here, for information: its default route prefers an
 * EU-resident endpoint (env.ts). No task is refused an endpoint for it any more: every call is redacted
 * before it leaves (redaction.ts, ADR-0007 amendment of 2026-10-20), but for a task marked `euOnly`, which
 * carries what Redaction does not take out: its calls are refused any endpoint outside the EU.
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
  /**
   * Eval Runs (#231, ADR-0023): the AI judge scoring a reply against an Eval Case's criteria. Eval Cases are
   * fictional, so the judge need not be EU-resident. The calls an Eval Run plays (the AI Coach, its Playbook
   * Agents, its Guardrails) are recorded on this task too, but keep their own task's data rules (`AiLayer.forEval`).
   */
  eval: { personalData: false },
  /** Reading an uploaded CV into a structured Master CV: reads CVs. */
  cv_parsing: { personalData: true },
  /**
   * The onboarding interview the AI Coach leads without a CV (#1002, ADR-0105): the Candidate's answers so far and the
   * draft they made. Routed like cv_parsing unless set: where a CV is read.
   */
  onboarding_interview: { personalData: true },
  /** Extracting structured fields from a Job Offer: public posting text only. */
  offer_analysis: { personalData: false },
  /** Job title variants for a Job Search's queries: given the Search Criteria title alone. */
  job_titles: { personalData: false },
  /**
   * Email intake reading a Received offer email (ADR-0052): it may name a recruiter or a contact, which
   * Redaction does not take out, so it runs only on an EU endpoint, whatever the Candidate's EU AI Consent.
   */
  offer_email_reading: { personalData: true, euOnly: true },
  /**
   * The « Contenu piégé dans un email » Guardrail's model check (#446, ADR-0052): it reads the same email as
   * offer_email_reading, recruiters' and contacts' names included, so it too runs only on an EU endpoint.
   */
  email_guardrail: { personalData: true, euOnly: true },
} as const satisfies Record<string, { personalData: boolean; euOnly?: true }>;
export type TextTask = keyof typeof TEXT_TASKS;

/** Whether `task`'s calls are refused any endpoint outside the EU (ADR-0052), whatever EU AI Consent. */
export const euOnly = (task: TextTask): boolean => "euOnly" in TEXT_TASKS[task];

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

/**
 * A tool the model may call during one text call (ADR-0077): its name, what it does and the JSON Schema of its
 * arguments. The caller's code runs it (`GenerateRequest.runTool`), never an AI call. A name is 1 to 64 letters,
 * digits, `_` or `-`, as every provider takes it.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** The JSON Schema of its arguments: an object schema. */
  parameters: Record<string, unknown>;
}

/** Text in a message made of blocks. */
export interface TextBlock {
  type: "text";
  text: string;
}

/** The model calling one of the call's tools: the id the provider gave the call, the tool's name, its arguments. */
export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  /** The arguments as the model wrote them: a JSON object, else whatever it wrote (refused before any tool runs). */
  arguments: unknown;
}

/** What a tool call gave back to the model, by the call's id: the tool's result, or what went wrong (`error`). */
export interface ToolResultBlock {
  type: "tool_result";
  id: string;
  content: string;
  error?: true;
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock;

/**
 * A message of a call with tools: text, or blocks. The model's turn holds its text and tool calls (assistant), the
 * next one the tools' results (user). A call without tools only ever has text messages (`Message`).
 */
export interface TurnMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** Where a provider endpoint processes data; shown in the Back Office, and required "eu" of the identity route (EU AI consent). */
export type Residency = "eu" | "outside_eu";

export interface TextInput {
  model?: string;
  system?: string;
  /** Text messages; with `tools`, also blocks (the model's tool calls, the tools' results). */
  messages: TurnMessage[];
  maxTokens: number;
  /** How hard the model should think (#225); each adapter translates it, or leaves it out for a model that has no such setting (see effort.ts). */
  effort?: Effort;
  /** Stops the call (#325): the adapter passes it to its HTTP request and rejects with its reason once aborted. */
  signal?: AbortSignal;
  /**
   * The tools the model may call (ADR-0077), only sent to a provider that declares `toolCalling`. Without them, the
   * request is exactly as it was before tool calling.
   */
  tools?: ToolDefinition[];
  /** "none": the model must answer in text, its tools only there to read the calls already made. Default "auto". */
  toolChoice?: "auto" | "none";
  /**
   * The stable prefix of a call with tools, for the provider's prompt cache (#790): every Turn of the call sends the same
   * tools, system text and first `prefixMessages` messages (the conversation it was asked), then the Turns before it, so the
   * next Turn may read them from the cache. `key` is the call's own, the same for all its Turns. Each adapter says it its
   * way (Claude: `cache_control` breakpoints; Mistral: `prompt_cache_key`), or leaves it out. Absent: nothing is marked.
   */
  cache?: { key: string; prefixMessages: number };
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
  /** The model's calls of the input's `tools`, in order, for the caller to run. Absent or empty: it answered. */
  toolCalls?: ToolCallBlock[];
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
 * Narrows a web search: one contract every Search provider honours (ADR-0043). A provider sends
 * those its API offers (`handled`); the AI layer applies the others to the pages it returns
 * (`emulated`, see `SearchContract`). Callers still check every result (e.g. ADR-0002's forbidden sites).
 * Never built from a Profile or CV: like the query, it is not personal data.
 */
export interface SearchFilters {
  /** Only pages on these sites (domain names such as "apec.fr"; a subdomain counts as its site). */
  includeDomains?: string[];
  /** No pages on these sites. */
  excludeDomains?: string[];
  /** Only pages published within this many days (emulated only on pages whose date is known). */
  maxAgeDays?: number;
  /** Favour pages from this country (ISO 3166-1 alpha-2, e.g. "FR"): a preference, not a restriction, never emulated. */
  country?: string;
  /** At most this many results per query. Default: the provider's most (20 for every Search provider). */
  maxResults?: number;
}

/** The filters of the contract, by name. */
export const SEARCH_FILTERS = ["includeDomains", "excludeDomains", "country", "maxAgeDays", "maxResults"] as const satisfies readonly (keyof SearchFilters)[];
export type SearchFilterName = (typeof SEARCH_FILTERS)[number];

/** `handled`: the provider is sent the filter; `emulated`: it is not, and the AI layer applies it to the pages returned. */
export type FilterHandling = "handled" | "emulated";

/** What a Search provider declares of itself (ADR-0043): how many queries one call takes, how far it pages, which filters it handles. */
export interface SearchContract {
  /** Queries one call may carry, billed as one search (Perplexity: up to 5). */
  queriesPerCall: number;
  /** Pages of results one query can be given (`SearchOptions.page`). */
  maxPages: number;
  filters: Record<SearchFilterName, FilterHandling>;
}

/** The contract of a provider that declares none: one query, one page, every filter left to it. */
export const DEFAULT_SEARCH_CONTRACT: SearchContract = {
  queriesPerCall: 1,
  maxPages: 1,
  filters: { includeDomains: "handled", excludeDomains: "handled", country: "handled", maxAgeDays: "handled", maxResults: "handled" },
};

/** `provider`'s search contract, or the default one. */
export const searchContractOf = (provider: Pick<AiProvider, "searchContract">): SearchContract => provider.searchContract ?? DEFAULT_SEARCH_CONTRACT;

export interface SearchOptions {
  model?: string;
  filters?: SearchFilters;
  /** Which page of results, from 1 (the default) up to the contract's `maxPages`. */
  page?: number;
  /** Stops the search (#325): the adapter passes it to its HTTP request and rejects with its reason once aborted. */
  signal?: AbortSignal;
}

/** The seam every provider adapter fills. */
export interface AiProvider {
  readonly id: ProviderId;
  /** Human-readable endpoint, e.g. "bedrock eu-west-3"; used in errors and logs. */
  readonly endpoint: string;
  readonly residency: Residency;
  /** The model it uses when the route names none, by name: what a failed call is recorded with. */
  readonly defaultModel?: string;
  /**
   * The model it uses when the route names none, for a call's effort, when that depends on the effort (Claude's
   * direct API); without it, `defaultModel` whatever the effort.
   */
  defaultModelFor?(effort?: Effort): string;
  /** The default model for each effort, when `defaultModelFor` follows it: what the Back Office shows. */
  readonly modelByEffort?: Readonly<Record<Effort, string>>;
  /** The text models it offers a Playbook Agent (#225), by the name this endpoint knows them by, its default model first. */
  readonly models?: readonly string[];
  generate?(input: TextInput): Promise<TextOutput>;
  /**
   * Whether `generate` takes `tools` (ADR-0077): Claude, Mistral and OpenAI do. A provider that does not is called
   * without them, as before tool calling.
   */
  readonly toolCalling?: boolean;
  /**
   * How the provider caches a prompt's prefix (#790), when `TextInput.cache` is given: "explicit", only where the call marks
   * it (Claude's `cache_control`); "automatic", by itself, the call only helping it (Mistral's `prompt_cache_key`, OpenAI).
   * Absent: it caches nothing, so the AI layer resends earlier Tool rounds' results as a digest.
   */
  readonly promptCache?: "explicit" | "automatic";
  /**
   * One web search: a query, or up to `searchContract.queriesPerCall` of them in one call (more is refused).
   * Their pages come back together, never attributed to a query.
   */
  search?(query: string | readonly string[], options: SearchOptions): Promise<SearchOutput>;
  /** What a Search provider declares of itself. Default: `DEFAULT_SEARCH_CONTRACT`. */
  readonly searchContract?: SearchContract;
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

/**
 * A degraded path the feature an AI call serves took (ADR-0030, #260): a Task Playbook fallback, a Playbook
 * Agent left out, Redaction by shape alone… Its code (from the Failure Reason catalog), and what happened,
 * written by the code: never the Candidate's text.
 */
export interface AiWarning {
  reason: FailureReason;
  /** e.g. `task Playbook "cv-reading" v3 has no section "fr"`; scrubbed, redacted by shape and cut when recorded. */
  detail?: string;
}

export interface UsageEntry extends TokenUsage {
  /**
   * The call's id, given by the AI layer before it is recorded (a UUID): what it served links to it with `callId` (#731),
   * and a usage log keeps it as the call's own. Absent on an entry made elsewhere.
   */
  id?: string;
  /** null for a Guest (browser extension without an account), and for a test (`test`). */
  candidateId: string | null;
  /**
   * True for a call made to test the AI, for no one: an Eval Run's (`AiLayer.forEval`) or a route's test call
   * (`checkAiRoutingChange`). Absent for any other call. So a call for no Candidate is told from a Guest's (#926).
   */
  test?: true;
  task: AiTask;
  /** Null for a call stopped before any provider was chosen (no route for its task). */
  provider: ProviderId | null;
  /** Null for a call stopped before it reached one of the provider's endpoints. */
  endpoint: string | null;
  /**
   * The model that answered; for a failed call, the route's model, else the provider's default model (or its
   * id when it names none); null for a call stopped before it had one.
   */
  model: string | null;
  /** How the call ended (ADR-0030): ok, warning (worked, degraded) or failed. A failed call is recorded too, with no tokens. */
  outcome: Outcome;
  /** Why it failed or warned (its Failure Reason's code); absent when ok. */
  reason?: FailureReason;
  /**
   * What the error said: its class, provider, HTTP status and message, scrubbed, redacted and cut. Personal data:
   * only the AI Message Log keeps it, as it keeps the transcript.
   */
  technicalReason?: TechnicalReason;
  /**
   * The warnings of the feature the call served (#260), when it took a degraded path: a call that worked is
   * Outcome warning with the first as its reason; a failed one keeps its own reason and carries them besides.
   * Absent when none. Their details only go with the transcript (the AI Message Log).
   */
  warnings?: AiWarning[];
  /** Whether the call left for its provider; false for one stopped before (missing key or route, data residency), which costs nothing. */
  sent: boolean;
  /** How long the provider took to answer or fail; 0 for a call stopped before it was sent. */
  durationMs: number;
  /** The tokens' estimated € at list price (`costInEur`); the tools' fees are apart, in `tools`. */
  costEur: number;
  /** The tools the call used. */
  tools: ToolUse[];
  /** What the call said (or would have said, when not sent). A usage log that is not the AI Message Log must leave it out, and `technicalReason` too. */
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
