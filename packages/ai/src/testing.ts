/**
 * Test doubles for the AI layer: a fake provider that never leaves the process,
 * and an in-memory usage log. Import from "@jobhub/ai/testing".
 */
import { DEFAULT_SEARCH_CONTRACT } from "./types";
import type {
  AiProvider,
  SearchContract,
  ProviderId,
  Residency,
  SearchOptions,
  SearchOutput,
  TextInput,
  TextOutput,
  TokenUsage,
  ToolCall,
  UsageEntry,
  UsageLog,
} from "./types";

export interface FakeProviderOptions {
  /** Which real provider this fake stands in for. Default "anthropic". */
  id?: ProviderId;
  /** Default "eu". */
  residency?: Residency;
  /** Fixed reply, or a function of the input. Default "fake reply". */
  reply?: string | ((input: TextInput) => string);
  /** Fixed search answer. Default "fake answer". */
  answer?: string;
  /** Fixed search sources, or a function of the query and its options (e.g. the page). */
  sources?: string[] | ((query: string, options: SearchOptions) => string[]);
  /** The dates the search states for some sources (by URL). Default: none. */
  sourceDates?: Record<string, Date>;
  usage?: TokenUsage;
  /** The tools the provider says the model used, on every call. Default: not said. */
  tools?: ToolCall[];
  /** How many pages of results a search can give. Default: 1. */
  pages?: number;
  /** How many queries one search may carry. Default: 1. */
  queriesPerCall?: number;
  /** Which filters it declares emulated (the AI layer then applies them). Default: none, all handled. */
  emulates?: (keyof SearchContract["filters"])[];
  /** The models it offers a Playbook Agent. Default: its default model alone. */
  models?: string[];
  /** Thrown by every call (generation and search), after it is counted: a provider that fails, e.g. with an AiProviderError. */
  fail?: Error;
  /**
   * Every call, once counted, never answers: it waits for its signal to abort, then rejects with the signal's
   * reason, as `fetch` does (#325). Default: it answers at once.
   */
  pending?: boolean;
}

export interface FakeProvider extends AiProvider {
  /** Every text input received, in order. */
  readonly calls: TextInput[];
  /** Every search query received, in order (a search carrying several gives each). */
  readonly queries: string[];
  /** Every search received, with its queries (`query`: them joined by new lines) and options (model, filters), in order. */
  readonly searches: ({ query: string; queries: string[] } & SearchOptions)[];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const id = options.id ?? "anthropic";
  const usage = options.usage ?? { inputTokens: 10, outputTokens: 5 };
  const calls: TextInput[] = [];
  const queries: string[] = [];
  const searches: FakeProvider["searches"] = [];
  /** Settles with nothing, or rejects as `fetch` does once `signal` aborts (`pending` never settles otherwise). */
  const answering = (signal: AbortSignal | undefined): Promise<void> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!options.pending) return Promise.resolve();
    return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  return {
    id,
    endpoint: `fake ${id}`,
    defaultModel: `fake-${id}`,
    models: options.models ?? [`fake-${id}`],
    residency: options.residency ?? "eu",
    calls,
    queries,
    searches,
    ...(options.pages || options.queriesPerCall || options.emulates
      ? {
          searchContract: {
            queriesPerCall: options.queriesPerCall ?? 1,
            maxPages: options.pages ?? 1,
            filters: {
              ...DEFAULT_SEARCH_CONTRACT.filters,
              ...Object.fromEntries((options.emulates ?? []).map((name) => [name, "emulated"])),
            },
          },
        }
      : {}),
    async generate(input): Promise<TextOutput> {
      calls.push(input);
      await answering(input.signal);
      if (options.fail) throw options.fail;
      const reply = options.reply ?? "fake reply";
      return { text: typeof reply === "function" ? reply(input) : reply, model: input.model ?? `fake-${id}`, usage, ...(options.tools ? { tools: options.tools } : {}) };
    },
    async search(asked, { model, filters, page, signal }): Promise<SearchOutput> {
      const all = [asked].flat();
      const query = all.join("\n");
      queries.push(...all);
      searches.push({ query, queries: all, model, filters, ...(page ? { page } : {}), ...(signal ? { signal } : {}) });
      await answering(signal);
      if (options.fail) throw options.fail;
      const sources = typeof options.sources === "function" ? all.flatMap((one) => (options.sources as (q: string, o: SearchOptions) => string[])(one, { model, filters, page })) : (options.sources ?? []);
      return {
        answer: options.answer ?? "fake answer",
        sources,
        ...(options.sourceDates ? { sourceDates: options.sourceDates } : {}),
        model: model ?? `fake-${id}`,
        usage,
        ...(options.tools ? { tools: options.tools } : {}),
      };
    },
  };
}

export interface MemoryUsageLog extends UsageLog {
  readonly entries: UsageEntry[];
  totalFor(candidateId: string): TokenUsage;
}

export function createMemoryUsageLog(): MemoryUsageLog {
  const entries: UsageEntry[] = [];
  return {
    entries,
    record(entry) {
      entries.push(entry);
    },
    totalFor(candidateId) {
      return entries
        .filter((e) => e.candidateId === candidateId)
        .reduce((sum, e) => ({ inputTokens: sum.inputTokens + e.inputTokens, outputTokens: sum.outputTokens + e.outputTokens }), {
          inputTokens: 0,
          outputTokens: 0,
        });
    },
  };
}
