/**
 * Effort (#225): how hard a model should think before answering, as a Playbook Agent asks for it
 * (low, medium or high), and how each provider's model takes it. Looked up 2026-10-19
 * (docs/research/issue-225.md): Claude's `output_config.effort` (Opus 4.5 to 5.5, Sonnet 4.6 and 5.x,
 * Haiku 5.5 and the 5.x frontier models), OpenAI's `reasoning_effort` (its reasoning models), and
 * Mistral's `reasoning_effort`, which only has "none" and "high" (Small, Medium 3.5 and Large 4).
 * Any other model ignores it; the Back Office says so.
 */
import type { ProviderId } from "./types";

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);

/**
 * `native`: low, medium and high are sent as they are. `medium_as_high`: the model only has none and
 * high, so low is sent as none and medium as high. `ignored`: nothing is sent, the model has no such setting.
 */
export type EffortHandling = "native" | "medium_as_high" | "ignored";

/** Matched against the model name, whatever the endpoint's prefix (e.g. Bedrock's "anthropic."). */
const NATIVE: Partial<Record<ProviderId, RegExp>> = {
  anthropic: /claude-(?:(?:fable|mythos)-5|opus-(?:4-[5-9]|5)|sonnet-(?:4-[6-9]|5)|haiku-5)/,
  openai: /^(?:gpt-(?:[5-9]|\d{2})|o\d)/,
};
const MEDIUM_AS_HIGH: Partial<Record<ProviderId, RegExp>> = {
  mistral: /^mistral-(?:small-latest|medium-3-5|large-4)/,
};

export function effortHandling(provider: ProviderId, model: string): EffortHandling {
  if (NATIVE[provider]?.test(model)) return "native";
  if (MEDIUM_AS_HIGH[provider]?.test(model)) return "medium_as_high";
  return "ignored";
}
