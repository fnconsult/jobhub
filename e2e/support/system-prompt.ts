import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

/**
 * A fresh "E2E_SHOW_CONTEXT#<tag>": put in a message to the AI Coach or the Back Office Assistant, it has
 * the fake Mistral print the system prompt it was sent to the server log (support/fake-mistral.mjs).
 * Tagged, so parallel tests never read each other's.
 */
export function showSystemPrompt(): string {
  return `E2E_SHOW_CONTEXT#${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The system prompt the fake Mistral was sent with `show` (from showSystemPrompt), the latest one. */
export async function systemPromptShown(show: string): Promise<string> {
  const prefix = `[fake-mistral] system prompt ${show.slice("E2E_SHOW_CONTEXT".length)}: `;
  const lines = () => readFileSync(process.env.E2E_SERVER_LOG!, "utf8").split("\n").filter((line) => line.startsWith(prefix));
  await expect.poll(() => lines().length, { message: `system prompt ${show} in the server log` }).toBeGreaterThan(0);
  return JSON.parse(lines().at(-1)!.slice(prefix.length)) as string;
}
