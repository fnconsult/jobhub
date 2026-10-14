/**
 * Test doubles for the AI layer: a fake provider that never leaves the process,
 * and an in-memory usage log. Import from "@jobhub/ai/testing".
 */
import type {
  AiProvider,
  ProviderId,
  Residency,
  SearchOptions,
  SearchOutput,
  TextInput,
  TextOutput,
  TokenUsage,
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
  /** How many pages of results a search can give. Default: 1. */
  pages?: number;
}

export interface FakeProvider extends AiProvider {
  /** Every text input received, in order. */
  readonly calls: TextInput[];
  /** Every search query received, in order. */
  readonly queries: string[];
  /** Every search received, with its options (model, filters), in order. */
  readonly searches: ({ query: string } & SearchOptions)[];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const id = options.id ?? "anthropic";
  const usage = options.usage ?? { inputTokens: 10, outputTokens: 5 };
  const calls: TextInput[] = [];
  const queries: string[] = [];
  const searches: FakeProvider["searches"] = [];
  return {
    id,
    endpoint: `fake ${id}`,
    residency: options.residency ?? "eu",
    calls,
    queries,
    searches,
    ...(options.pages ? { searchPages: options.pages } : {}),
    async generate(input): Promise<TextOutput> {
      calls.push(input);
      const reply = options.reply ?? "fake reply";
      return { text: typeof reply === "function" ? reply(input) : reply, model: input.model ?? `fake-${id}`, usage };
    },
    async search(query, { model, filters, page }): Promise<SearchOutput> {
      queries.push(query);
      searches.push({ query, model, filters, ...(page ? { page } : {}) });
      const sources = typeof options.sources === "function" ? options.sources(query, { model, filters, page }) : (options.sources ?? []);
      return {
        answer: options.answer ?? "fake answer",
        sources,
        ...(options.sourceDates ? { sourceDates: options.sourceDates } : {}),
        model: model ?? `fake-${id}`,
        usage,
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
