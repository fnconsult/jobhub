/**
 * « Clés d'agent » in the Back Office (#1139, ADR-0118): a super-admin creates and revokes the Agent Keys, each change
 * recorded in the Back Office Audit by the key's name, with its scope and expiry, never its value.
 *
 * `createAgentKeysBackOffice(agentKeys, backOffice)` answers `create` (the value returned once, to be shown once) and
 * `revoke` (recorded once: revoking it again changes and records nothing). A key refused (a name malformed or taken,
 * an expiry beyond AGENT_KEY_MAX_DAYS) records nothing; it is only shown on the page. The page checks the
 * `agentKeys` resource first (super-admins only).
 */
import type { AgentKey, AgentKeys, CreateResult } from "../agent-keys";
import type { BackOffice, BackOfficeActor, BackOfficeAttempt } from "./back-office";

export type RevokeResult = { ok: true; key: AgentKey } | { ok: false; error: "not_found" };

export interface AgentKeysBackOffice {
  /** `input` is untrusted (a form's values): { name, scope, days }. */
  create(actor: BackOfficeActor, input: unknown): Promise<CreateResult>;
  revoke(actor: BackOfficeActor, id: string): Promise<RevokeResult>;
}

const SECTION = "agent_keys";

export function createAgentKeysBackOffice(agentKeys: Pick<AgentKeys, "create" | "revoke">, backOffice: Pick<BackOffice, "record">): AgentKeysBackOffice {
  return {
    create(actor, input) {
      return backOffice.record(
        actor,
        (within) => agentKeys.create(input, within),
        (result): BackOfficeAttempt | null =>
          result.ok ? { section: SECTION, target: result.key.name, action: "added", before: null, after: { scope: result.key.scope, expiresAt: result.key.expiresAt.toISOString() } } : null,
      );
    },

    async revoke(actor, id) {
      const done = await backOffice.record(
        actor,
        (within) => agentKeys.revoke(id, within),
        (result): BackOfficeAttempt | null =>
          result && result.before.revokedAt === null && result.after.revokedAt
            ? { section: SECTION, target: result.after.name, action: "revoked", before: { revokedAt: null }, after: { revokedAt: result.after.revokedAt.toISOString() } }
            : null,
      );
      return done ? { ok: true, key: done.after } : { ok: false, error: "not_found" };
    },
  };
}
