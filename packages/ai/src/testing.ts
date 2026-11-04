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
  ToolCallBlock,
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
   * Scripted turns of a call with tools (#712): each text call takes the next one, the last one repeating. A turn calls
   * its `toolCalls` (each given the id `call_<n>`, counted across the fake's calls, unless it names one), only when the
   * input offers tools it may call (`tools`, and not `toolChoice: "none"`), as a real model can; else it answers its
   * `text` (default: `reply`). Default: no script, every call answers `reply`.
   */
  turns?: FakeTurn[];
  /** Whether it declares tool calling (`AiProvider.toolCalling`). Default: it does, as every text provider does. */
  toolCalling?: boolean;
  /**
   * Every call, once counted, never answers: it waits for its signal to abort, then rejects with the signal's
   * reason, as `fetch` does (#325). Default: it answers at once.
   */
  pending?: boolean;
}

/** One scripted turn of the fake model (`FakeProviderOptions.turns`). */
export interface FakeTurn {
  /** Its text. Default: none when it calls tools, else the fake's `reply`. */
  text?: string;
  /** The tools it calls, with their arguments; the id is `call_<n>` unless given. */
  toolCalls?: { name: string; arguments: unknown; id?: string }[];
  /** Its tokens. Default: the fake's `usage`. */
  usage?: TokenUsage;
  /** Thrown instead of answering. */
  fail?: Error;
  /** It waits for its signal to abort, as `pending` (default: the fake's). */
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
  let toolCallIds = 0;
  /** Settles with nothing, or rejects as `fetch` does once `signal` aborts (`pending` never settles otherwise). */
  const answering = (signal: AbortSignal | undefined, pending = options.pending): Promise<void> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (!pending) return Promise.resolve();
    return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  return {
    id,
    endpoint: `fake ${id}`,
    defaultModel: `fake-${id}`,
    models: options.models ?? [`fake-${id}`],
    residency: options.residency ?? "eu",
    toolCalling: options.toolCalling ?? true,
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
      const turns = options.turns ?? [];
      const turn = turns[Math.min(calls.length, turns.length) - 1];
      await answering(input.signal, turn?.pending ?? options.pending);
      if (turn?.fail ?? options.fail) throw turn?.fail ?? options.fail;
      const mayCall = Boolean(input.tools?.length) && input.toolChoice !== "none";
      const toolCalls: ToolCallBlock[] = mayCall ? (turn?.toolCalls ?? []).map((call) => ({ type: "tool_call", id: call.id ?? `call_${++toolCallIds}`, name: call.name, arguments: call.arguments })) : [];
      // A turn that calls tools has no text unless scripted, as a model calling a tool often writes none.
      const reply = turn?.text ?? (toolCalls.length > 0 ? "" : (options.reply ?? "fake reply"));
      return {
        text: typeof reply === "function" ? reply(input) : reply,
        model: input.model ?? `fake-${id}`,
        usage: turn?.usage ?? usage,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
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
