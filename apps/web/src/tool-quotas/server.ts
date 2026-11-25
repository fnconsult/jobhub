import { sharedPool } from "@/database/pool";
import { cachedToolQuotaStates, toolQuotaStates, type ToolQuotaState } from "./index";

let states: (() => Promise<ToolQuotaState[]>) | null = null;

/**
 * Each Tool's quota state now, read in one bounded query at most every 30 s for every page of every Administrator
 * (`cachedToolQuotaStates`): the « Quota atteint » banner (#1115) and the Dashboard's « API » block (#1116) share it. The
 * e2e suite writes the calls itself and reads the very next page: it reads every time.
 */
export function currentToolQuotaStates(): Promise<ToolQuotaState[]> {
  states ??= cachedToolQuotaStates((now) => toolQuotaStates(sharedPool(), now), process.env.JOBHUB_TARGET?.trim() === "e2e" ? { ttlMs: 0 } : {});
  return states();
}
