/**
 * Tool quota states (#1114): whether each Tool with a quota at its provider (an AI model, a web search provider, a
 * contact enrichment provider, Fantastic.jobs: `hasQuota`) is refused for it, read from its recorded calls.
 *
 *   toolQuotaStates(database, now)            every Tool with a quota: ok, rate_limited (« limite atteinte ») or
 *                                             quota_exhausted (« quota épuisé »), since when, and the renewal date its
 *                                             provider gave
 *   cachedToolQuotaStates(read, { ttlMs })    the same, read at most once per TTL however many pages ask (#1115)
 *
 * The rule: a state starts at the provider's first refusal for its quota (a call recorded failed with Failure Reason
 * `rate_limited` or `quota_exhausted`, in AI Usage or `external_api_usage`, Fantastic.jobs' quota guard included). It
 * lasts while the provider refuses, and ends at the first call of that Tool the provider accepts, or at the renewal
 * date it gave (`renews_at`: its `retry-after`, Fantastic.jobs' next billing date) when it gave one. A refusal after
 * that date starts a new state: `since` never walks back over a renewal that had passed. A connection test the
 * provider passes ends nothing: it checks the key, not the quota (listing Claude's models works with no credit left).
 * Nothing is stored but the calls: the state is read from them each time. A Tool's calls are its AI calls (Claude per
 * endpoint) and its other calls (an AI Tool's key's connection test), as its Outils page lists them.
 *
 * Read on every Back Office page (the « Quota atteint » banner, #1115), so bounded: only the last LOOKBACK_DAYS of
 * calls, a Tool's refusals found through the partial indexes of the refusals alone (`*_quota_refusal_idx`), and its
 * latest accepted call looked for only once it has one. With no refusal anywhere, one index probe per Tool and table.
 * Read-only; no payload, no Candidate.
 */
import { CONNECTION_TEST_OPERATION, externalApiProvidersOf, hasQuota, TOOLS, type QuotaRefusalReason, type Tool } from "@jobhub/shared";
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

const OK: QuotaState = { state: "ok", since: null, renewsAt: null };

/**
 * How far back the calls are read: a month, the longest a provider's quota runs before it is renewed. A refusal older
 * than that with no call of its Tool since is no state any more; a state's `since` is never older.
 */
export const LOOKBACK_DAYS = 31;

/**
 * A refusal for its quota, as the partial indexes `*_quota_refusal_idx` (migrateAiUsage) hold them: written out, not a
 * parameter, so that Postgres sees those indexes serve the query.
 */
const REFUSED = `reason IN ('rate_limited', 'quota_exhausted')`;

/**
 * Each refused Tool's state, in one query. $1…$4: the Tools' ids, their AI calls' provider and endpoint prefix (null:
 * none), and their `external_api_usage` provider (null: none); $5: from when calls are read; $6: a connection test's
 * operation. A Tool is read further only once one refusal of it is found (`refused`). Its refusals since its latest
 * accepted call are then marked where a state starts (the first, a reason other than the one before, or after the
 * renewal date the one before gave): its state is the latest one's, since the latest start.
 */
const QUOTA_STATES = `
  WITH refused AS (
    SELECT tool.*
      FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS tool (id, ai_provider, endpoint, external)
     WHERE EXISTS (SELECT 1 FROM ai_usage u WHERE u.provider = tool.ai_provider AND u.${REFUSED} AND u.at > $5 AND u.outcome = 'failed' AND starts_with(coalesce(u.endpoint, ''), tool.endpoint))
        OR EXISTS (SELECT 1 FROM external_api_usage e WHERE e.provider = tool.external AND e.${REFUSED} AND e.at > $5 AND NOT e.ok)
  )
  SELECT refused.id, run.state, run.since, run.renews_at AS "renewsAt"
    FROM refused
   CROSS JOIN LATERAL (
     SELECT greatest($5::timestamptz,
       (SELECT u.at FROM ai_usage u WHERE u.provider = refused.ai_provider AND u.at > $5 AND u.ok AND starts_with(coalesce(u.endpoint, ''), refused.endpoint) ORDER BY u.at DESC LIMIT 1),
       (SELECT e.at FROM external_api_usage e WHERE e.provider = refused.external AND e.at > $5 AND e.ok AND e.operation <> $6 ORDER BY e.at DESC LIMIT 1)
     ) AS at
   ) accepted
   CROSS JOIN LATERAL (
     SELECT (array_agg(marked.reason ORDER BY marked.at DESC))[1] AS state,
            (array_agg(marked.renews_at ORDER BY marked.at DESC))[1] AS renews_at,
            max(marked.at) FILTER (WHERE marked.starts) AS since
       FROM (
         SELECT r.at, r.reason, r.renews_at,
                coalesce(lag(r.reason) OVER w IS DISTINCT FROM r.reason OR lag(r.renews_at) OVER w <= r.at, false) AS starts
           FROM (
             SELECT u.at, u.reason, u.renews_at FROM ai_usage u
              WHERE u.provider = refused.ai_provider AND u.${REFUSED} AND u.at > accepted.at AND u.outcome = 'failed' AND starts_with(coalesce(u.endpoint, ''), refused.endpoint)
             UNION ALL
             SELECT e.at, e.reason, e.renews_at FROM external_api_usage e
              WHERE e.provider = refused.external AND e.${REFUSED} AND e.at > accepted.at AND NOT e.ok
           ) r
         WINDOW w AS (ORDER BY r.at)
       ) marked
   ) run
   WHERE run.state IS NOT NULL`;

const QUOTA_TOOLS: readonly Tool[] = (TOOLS as readonly Tool[]).filter(hasQuota);

/** The query `toolQuotaStates` runs at `now`: for its test of the indexes it goes through. */
export function quotaStatesQuery(now: Date): { text: string; values: unknown[] } {
  const ai = QUOTA_TOOLS.map(({ usage }) => (usage?.table === "ai_usage" ? usage : null));
  const values = [
    QUOTA_TOOLS.map((tool) => tool.id),
    ai.map((usage) => usage?.provider ?? null),
    ai.map((usage) => usage?.endpoint ?? ""),
    // One `external_api_usage` provider at most per Tool: its own, or its AI key's connection test's.
    QUOTA_TOOLS.map((tool) => externalApiProvidersOf(tool)[0] ?? null),
    new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600_000),
    CONNECTION_TEST_OPERATION,
  ];
  return { text: QUOTA_STATES, values };
}

/** Every Tool with a quota, in the catalog's order, with its quota state at `now`; never a Tool without one. */
export async function toolQuotaStates(database: Pick<Pool, "query">, now: Date): Promise<ToolQuotaState[]> {
  const { text, values } = quotaStatesQuery(now);
  const { rows } = await database.query<{ id: string; state: QuotaRefusalReason; since: Date; renewsAt: Date | null }>(text, values);
  const refused = new Map(rows.map(({ id, ...state }) => [id, state]));
  return QUOTA_TOOLS.map((tool) => ({ tool, ...atNow(refused.get(tool.id) ?? OK, now) }));
}

/** `state` at `now`: ok once the renewal date its provider gave has passed. */
function atNow(state: QuotaState, now: Date): QuotaState {
  return state.renewsAt !== null && state.renewsAt.getTime() <= now.getTime() ? OK : state;
}

/** How long the states read are served before they are read again (#1115): the banner asks on every Back Office page. */
export const CACHE_TTL_MS = 30_000;

export interface CachedToolQuotaStatesOptions {
  /** Default: CACHE_TTL_MS; 0 reads on every ask. */
  ttlMs?: number;
  clock?: () => Date;
}

/**
 * `read` (`toolQuotaStates` on a database) at most once per `ttlMs` however many ask; asks meanwhile share the read in
 * flight. A failed read is not kept: the next ask reads again. A state whose renewal date has passed is served as ok.
 */
export function cachedToolQuotaStates(read: (now: Date) => Promise<ToolQuotaState[]>, options: CachedToolQuotaStatesOptions = {}): () => Promise<ToolQuotaState[]> {
  const ttlMs = options.ttlMs ?? CACHE_TTL_MS;
  const clock = options.clock ?? (() => new Date());
  let cached: { at: number; states: Promise<ToolQuotaState[]> } | null = null;
  return async () => {
    const now = clock();
    if (cached === null || now.getTime() - cached.at >= ttlMs) {
      const reading = { at: now.getTime(), states: read(now) };
      cached = reading;
      reading.states.catch(() => {
        if (cached === reading) cached = null;
      });
    }
    const states = await cached.states;
    return states.map((state) => ({ ...state, ...atNow(state, now) }));
  };
}
