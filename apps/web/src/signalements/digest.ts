/**
 * The « Signalements » section of Livraison's daily email (#1141, ADR-0118), computed by Jobbbox from its own data, for
 * the 24 hours before it is sent: the new Signalements by type, in this environment (each environment holds its own);
 * the issues opened, or only completed with a duplicate, with their links; how many are « Prêt à clore » with a draft
 * waiting for Support; and whether Signalement triage ran (the last call an Agent Key made), or why not: no key, a key
 * expired or revoked, or no call that day. Counts and issue links only, never a Candidate's text.
 */
import type { AgentKey, AgentKeyCall, AgentKeys } from "../agent-keys";
import type { SignalementCounts, Signalements } from "./index";

/** How far back the section looks: since the previous day's email. */
export const DIGEST_HOURS = 24;

/** Whether the day's triage ran: when, or why not. */
export type TriagePass = { ran: true; at: Date } | { ran: false; reason: "no_key" | "key_expired" | "key_revoked" | "no_call" };

export interface SignalementsDigest extends Omit<SignalementCounts, "issues"> {
  /** Where this server runs (Release.environment): the Signalements counted were sent there. */
  environment: string;
  issues: (SignalementCounts["issues"][number] & { url: string })[];
  triage: TriagePass;
}

/**
 * The day's triage pass, from the Agent Keys and their latest calls: the last call let through since `since`; otherwise
 * a key refused as expired or revoked when it tried, or every key expired or revoked; otherwise no call.
 */
export function triagePass(keys: readonly { key: AgentKey; calls: readonly AgentKeyCall[] }[], since: Date, now: Date): TriagePass {
  if (keys.length === 0) return { ran: false, reason: "no_key" };
  const last = keys.map(({ key }) => key.lastUsedAt).filter((at): at is Date => at !== null && at >= since).sort((a, b) => b.getTime() - a.getTime())[0];
  if (last) return { ran: true, at: last };
  const refused = keys.flatMap(({ calls }) => calls).filter((each) => each.at >= since && (each.outcome === "expired" || each.outcome === "revoked")).sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (refused) return { ran: false, reason: refused.outcome === "expired" ? "key_expired" : "key_revoked" };
  const usable = keys.filter(({ key }) => key.revokedAt === null && key.expiresAt > now);
  if (usable.length === 0) return { ran: false, reason: keys.some(({ key }) => key.revokedAt === null) ? "key_expired" : "key_revoked" };
  return { ran: false, reason: "no_call" };
}

export interface SignalementsDigestDeps {
  signalements: Pick<Signalements, "countsSince">;
  agentKeys: Pick<AgentKeys, "list" | "calls">;
  environment: string;
  /** The page of an issue on Jobbbox's repository. */
  issueUrl: (number: number) => string;
  now?: () => Date;
}

/** The section's figures, for the DIGEST_HOURS before now. */
export async function signalementsDigest({ signalements, agentKeys, environment, issueUrl, now = () => new Date() }: SignalementsDigestDeps): Promise<SignalementsDigest> {
  const at = now();
  const since = new Date(at.getTime() - DIGEST_HOURS * 3_600_000);
  const [counts, keys] = await Promise.all([signalements.countsSince(since), agentKeys.list()]);
  const withCalls = await Promise.all(keys.filter((key) => key.scope === "signalements").map(async (key) => ({ key, calls: await agentKeys.calls(key.id) })));
  return {
    environment,
    newByType: counts.newByType,
    issues: counts.issues.map((issue) => ({ ...issue, url: issueUrl(issue.number) })),
    readyWithDraft: counts.readyWithDraft,
    triage: triagePass(withCalls, since, at),
  };
}
