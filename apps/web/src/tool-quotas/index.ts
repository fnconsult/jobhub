/**
 * Tool quota states (#1114): whether each Tool with a quota at its provider (an AI model, a web search provider, a
 * contact enrichment provider, Fantastic.jobs: `hasQuota`) is refused for it, read from its recorded calls.
 *
 *   toolQuotaStates(database, now)   every Tool with a quota: ok, rate_limited (« limite atteinte ») or
 *                                    quota_exhausted (« quota épuisé »), since when, and the renewal date its provider gave
 *   quotaStateOf(refusals, now)      the rule, on one Tool's refusals since its latest accepted call
 *
 * The rule: a state starts at the provider's first refusal for its quota (a call recorded failed with Failure Reason
 * `rate_limited` or `quota_exhausted`, in AI Usage or `external_api_usage`, Fantastic.jobs' quota guard included). It
 * lasts while the provider refuses, and ends at the first call of that Tool the provider accepts, or at the renewal
 * date it gave (`renews_at`: its `retry-after`, Fantastic.jobs' next billing date) when it gave one. Nothing is stored
 * but the calls: the state is read from them each time. A Tool's calls are its AI calls (Claude per endpoint) and its
 * other calls (an AI Tool's key's connection test), as its Outils page lists them. Read-only; no payload, no Candidate.
 */
import { externalApiProvidersOf, hasQuota, TOOLS, type QuotaRefusalReason, type Tool } from "@jobhub/shared";
import type { Pool } from "pg";

/** A Tool's quota state: not refused, its rate limit reached, or its credit or plan spent. */
export type ToolQuotaStatus = "ok" | QuotaRefusalReason;

export interface QuotaState {
  state: ToolQuotaStatus;
  /** When its provider first refused it, for this state; null when ok. */
  since: Date | null;
  /** When its provider said the quota is renewed; null when ok, or when it said nothing. */
  renewsAt: Date | null;
}

export interface ToolQuotaState extends QuotaState {
  tool: Tool;
}

/** One refusal of a Tool's calls for its quota, as recorded. */
export interface QuotaRefusalCall {
  at: Date;
  reason: QuotaRefusalReason;
  renewsAt: Date | null;
}

const OK: QuotaState = { state: "ok", since: null, renewsAt: null };

/**
 * A Tool's quota state at `now`, from its refusals since its latest accepted call, oldest first: the latest one's,
 * since the first of the same reason that led to it uninterrupted; ok with none, or once the renewal date it gave is past.
 */
export function quotaStateOf(refusals: readonly QuotaRefusalCall[], now: Date): QuotaState {
  const latest = refusals.at(-1);
  if (!latest || (latest.renewsAt !== null && latest.renewsAt.getTime() <= now.getTime())) return OK;
  let first = refusals.length - 1;
  while (first > 0 && refusals[first - 1]!.reason === latest.reason) first -= 1;
  return { state: latest.reason, since: refusals[first]!.at, renewsAt: latest.renewsAt };
}

const QUOTA_REFUSALS: readonly QuotaRefusalReason[] = ["rate_limited", "quota_exhausted"];

/**
 * One Tool's refusals for its quota since its latest accepted call, oldest first. $1, $2: its AI calls' provider and
 * endpoint prefix (none for a Tool whose calls are all external); $3: its `external_api_usage` providers.
 */
const REFUSALS = `
  WITH calls AS (
    SELECT u.at, u.ok AS accepted, CASE WHEN u.outcome = 'failed' THEN u.reason END AS reason, u.renews_at
      FROM ai_usage u WHERE u.provider = $1 AND starts_with(coalesce(u.endpoint, ''), $2)
    UNION ALL
    SELECT at, ok, CASE WHEN NOT ok THEN reason END, renews_at FROM external_api_usage WHERE provider = ANY($3::text[])
  )
  SELECT at, reason, renews_at AS "renewsAt" FROM calls
   WHERE reason = ANY($4::text[]) AND at > (SELECT coalesce(max(at), '-infinity'::timestamptz) FROM calls WHERE accepted)
   ORDER BY at`;

/** `tool`'s refusals for its quota since its latest accepted call, oldest first. */
async function refusalsOf(database: Pick<Pool, "query">, tool: Tool): Promise<QuotaRefusalCall[]> {
  const usage = tool.usage!;
  const ai = usage.table === "ai_usage" ? usage : null;
  const { rows } = await database.query<QuotaRefusalCall>(REFUSALS, [ai?.provider ?? null, ai?.endpoint ?? "", externalApiProvidersOf(tool), QUOTA_REFUSALS]);
  return rows;
}

/** Every Tool with a quota, in the catalog's order, with its quota state at `now`; never a Tool without one. */
export async function toolQuotaStates(database: Pick<Pool, "query">, now: Date): Promise<ToolQuotaState[]> {
  const tools = (TOOLS as readonly Tool[]).filter(hasQuota);
  return Promise.all(tools.map(async (tool) => ({ tool, ...quotaStateOf(await refusalsOf(database, tool), now) })));
}
