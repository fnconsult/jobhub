/**
 * The values of an Agent Key (#1139, ADR-0118): the ONLY list of each. Depends on nothing, on purpose: a page, a form or
 * a hook can import it without pulling in the database or node:crypto.
 */

/** What every Agent Key's value starts with: the secret-blocking hook (scripts/hooks/no-secrets.mjs) knows it. */
export const AGENT_KEY_PREFIX = "jbx_agent_";
/** The scopes a key may be given: one each. */
export const AGENT_KEY_SCOPES = ["signalements"] as const;
export type AgentKeyScope = (typeof AGENT_KEY_SCOPES)[number];
export const isAgentKeyScope = (value: unknown): value is AgentKeyScope => (AGENT_KEY_SCOPES as readonly unknown[]).includes(value);
/** The longest a key lives, in days. */
export const AGENT_KEY_MAX_DAYS = 90;
/** How many of its latest calls a key's log keeps. */
export const AGENT_KEY_LOG_SIZE = 50;
/**
 * How many calls a key may make in a rolling window, refused (429) beyond. Counted from the log, which keeps, past its
 * AGENT_KEY_LOG_SIZE latest calls, the allowed ones still in the window: at most AGENT_KEY_LOG_SIZE + `calls` rows a key.
 */
export const AGENT_KEY_RATE_LIMIT = { calls: 30, seconds: 60 } as const;
/** A key's name: lower-case letters, digits and hyphens, starting with a letter. */
export const AGENT_KEY_NAME = /^[a-z][a-z0-9-]{1,39}$/;

/** How a key's name signs what it changes (`statutMajPar`): « key:triage-beta ». */
export const agentSignature = (name: string): string => `key:${name}`;
/** The key's name a signature holds; null for anything else. */
export const signatureName = (signature: string | null): string | null => (signature?.startsWith("key:") ? signature.slice(4) : null);

/**
 * What happened to one call of a known key in its scope. `out_of_scope` is no longer logged (#1172: outside its scope a
 * key is ignored, not refused); it stays for the calls logged before, which the journal still shows.
 */
export const AGENT_KEY_OUTCOMES = ["allowed", "revoked", "expired", "out_of_scope", "rate_limited"] as const;
export type AgentKeyOutcome = (typeof AGENT_KEY_OUTCOMES)[number];
