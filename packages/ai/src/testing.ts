/**
 * Test doubles for the AI layer: a fake provider that never leaves the process,
 * and an in-memory usage log. Import from "@jobhub/ai/testing".
 */
import type { AiProvider, ProviderId, Residency, SearchOutput, TextInput, TextOutput, TokenUsage, UsageEntry, UsageLog } from "./types";

export interface FakeProviderOptions {
  /** Which real provider this fake stands in for. Default "anthropic". */
  id?: ProviderId;
  /** Default "eu". */
  residency?: Residency;
  /** Fixed reply, or a function of the input. Default "fake reply". */
  reply?: string | ((input: TextInput) => string);
  /** Fixed search answer. Default "fake answer". */
  answer?: string;
  sources?: string[];
  usage?: TokenUsage;
}

export interface FakeProvider extends AiProvider {
  /** Every text input received, in order. */
  readonly calls: TextInput[];
  /** Every search query received, in order. */
  readonly queries: string[];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const id = options.id ?? "anthropic";
  const usage = options.usage ?? { inputTokens: 10, outputTokens: 5 };
  const calls: TextInput[] = [];
  const queries: string[] = [];
  return {
    id,
    endpoint: `fake ${id}`,
    residency: options.residency ?? "eu",
    calls,
    queries,
    async generate(input): Promise<TextOutput> {
      calls.push(input);
      const reply = options.reply ?? "fake reply";
      return { text: typeof reply === "function" ? reply(input) : reply, model: input.model ?? `fake-${id}`, usage };
    },
    async search(query, { model }): Promise<SearchOutput> {
      queries.push(query);
      return { answer: options.answer ?? "fake answer", sources: options.sources ?? [], model: model ?? `fake-${id}`, usage };
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
