/**
 * How an Agent Key reaches the Back Office's API over HTTP (#1139, ADR-0118): `Authorization: Bearer jbx_agent_…`.
 *
 *  - `agentKeyRefusal`, in the proxy before any page or route runs: a request carrying an Agent Key outside its scopes'
 *    routes (AGENT_KEY_ROUTES) is answered 403, so a key never opens a Back Office page, an API route of the Back Office
 *    or of the Candidate. Read from the header alone, never from the database, as the proxy runs on every request.
 *  - `agentCall`, in each route of a scope: the key read afresh from the database (AgentKeys.authorize), its call logged.
 *    401, 403 and 429 are answered here, `no-store`. A route of a scope never reads a session: a key never stands
 *    for an Administrator, and an Administrator's session never opens these routes.
 */
import type { AgentKey, AgentKeys } from "./index";
import { AGENT_KEY_PREFIX, type AgentKeyScope } from "./values";

/** The routes each scope opens, and only them. */
export const AGENT_KEY_ROUTES: Record<AgentKeyScope, string> = { signalements: "/admin/api/signalements" };

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The Bearer value of the request's Authorization header; null without one. */
export function bearerKey(headers: Headers): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.get("authorization") ?? "");
  return match ? match[1]! : null;
}

/** Whether `pathname` is one of `scope`'s routes. */
const inScope = (pathname: string, scope: AgentKeyScope): boolean => pathname === AGENT_KEY_ROUTES[scope] || pathname.startsWith(`${AGENT_KEY_ROUTES[scope]}/`);

/**
 * The proxy's answer to a request carrying an Agent Key outside every scope's routes: 403 `out_of_scope`. Null when it
 * carries none, or asks for one of those routes (where `agentCall` checks it).
 */
export function agentKeyRefusal(pathname: string, headers: Headers): Response | null {
  if (!bearerKey(headers)?.startsWith(AGENT_KEY_PREFIX)) return null;
  if ((Object.keys(AGENT_KEY_ROUTES) as AgentKeyScope[]).some((scope) => inScope(pathname, scope))) return null;
  return Response.json({ error: "out_of_scope" }, { status: 403, headers: NO_STORE });
}

/** A JSON answer of the agent's API: never cached. */
export const agentJson = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });

/** Whether the request's Agent Key may make this call in `scope`, read afresh; the answer to give when it may not. */
export async function agentCall(request: Request, scope: AgentKeyScope, keys: Pick<AgentKeys, "authorize">): Promise<{ ok: true; key: AgentKey } | { ok: false; response: Response }> {
  const url = new URL(request.url);
  // A path outside the scope (a route that forgot to say its own) is refused even with a good key.
  const authorization = await keys.authorize(bearerKey(request.headers), inScope(url.pathname, scope) ? scope : "out_of_scope", {
    method: request.method,
    path: `${url.pathname}${url.search}`,
  });
  if (authorization.ok) return { ok: true, key: authorization.key };
  const response = Response.json(
    { error: authorization.status === 401 ? "unauthorized" : authorization.reason },
    { status: authorization.status, headers: { ...NO_STORE, ...(authorization.status === 401 ? { "WWW-Authenticate": 'Bearer realm="jobbbox-agent"' } : {}), ...(authorization.status === 429 ? { "Retry-After": "60" } : {}) } },
  );
  return { ok: false, response };
}
