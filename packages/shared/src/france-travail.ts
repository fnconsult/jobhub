/**
 * France Travail's access tokens (#400): one per API, each asked with only that API's scopes.
 *
 * A token request naming any scope the client is not granted fails as a whole with
 * `invalid_scope` (francetravail.io « Erreurs fréquentes », docs/research/issue-400.md), so
 * asking Offres d'emploi's scopes with La Bonne Boite's would lose both when Offres d'emploi is
 * refused. Here each API asks its own token, kept until a minute before it expires.
 *
 *   const tokens = createFranceTravailTokens({ clientId, clientSecret, fetch });
 *   await tokens.token("offres_emploi", now);  // { ok: true, value, calls } | { ok: false, reason, detail, calls }
 *   tokens.forget("offres_emploi");            // after the API turned the token down (401)
 *   await checkFranceTravailAccess(tokens, now); // the connection test: the client, then each API
 *
 * Never throws. `client_invalid`: the token endpoint does not know the client (`invalid_client`,
 * or a 401); `refused`: the client is not granted that API (`invalid_scope`, other 400 and 403);
 * `failed`: anything else (network, 5xx, an answer without a token).
 */

/** OAuth2 client-credentials token endpoint, in the "/partenaire" realm. */
export const FRANCE_TRAVAIL_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";

/** The France Travail APIs Jobbbox uses, La Bonne Boite first: the connection test validates the client with it. */
export const FRANCE_TRAVAIL_APIS = ["la_bonne_boite", "offres_emploi", "romeo"] as const;
export type FranceTravailApi = (typeof FRANCE_TRAVAIL_APIS)[number];
export const isFranceTravailApi = (value: unknown): value is FranceTravailApi => (FRANCE_TRAVAIL_APIS as readonly unknown[]).includes(value);

/**
 * The scopes each API's token asks for, alternatives in order: La Bonne Boite's OpenAPI also lists
 * `search` and `office`, which a client may or may not be granted (UNVERIFIED, #400), so it tries
 * them first, then `api_labonneboitev2` alone, and keeps the one that works.
 */
export const FRANCE_TRAVAIL_SCOPES: Record<FranceTravailApi, readonly string[]> = {
  la_bonne_boite: ["api_labonneboitev2 search office", "api_labonneboitev2"],
  offres_emploi: ["api_offresdemploiv2 o2dsoffre"],
  romeo: ["api_romeov2"],
};

export type FranceTravailToken =
  | { ok: true; value: string; calls: number }
  | { ok: false; reason: "client_invalid" | "refused" | "failed"; detail: string; calls: number };

export interface FranceTravailTokensOptions {
  clientId: string;
  clientSecret: string;
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Default: 15 s per call. */
  timeoutMs?: number;
}

export interface FranceTravailTokens {
  /** A token for `api` alone: the one kept, else a new one. Never throws. */
  token(api: FranceTravailApi, now: Date): Promise<FranceTravailToken>;
  /** Drops `api`'s kept token: the next `token` asks a new one. */
  forget(api: FranceTravailApi): void;
}

type Answered = FranceTravailToken | { ok: true; value: string; expiresAt: number };

export function createFranceTravailTokens(options: FranceTravailTokensOptions): FranceTravailTokens {
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const kept = new Map<FranceTravailApi, { value: string; expiresAt: number }>();
  /** The scopes that worked for an API with alternatives: tried first next time. */
  const working = new Map<FranceTravailApi, string>();

  async function ask(scope: string, now: Date): Promise<Answered> {
    let answer: Response;
    try {
      answer = await fetch(FRANCE_TRAVAIL_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: options.clientId, client_secret: options.clientSecret, scope }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, reason: "failed", detail: `token: network error: ${error instanceof Error ? error.message : String(error)}`, calls: 1 };
    }
    const body = (await answer.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | null;
    const error = typeof body?.error === "string" ? body.error : "";
    const detail = `token refused (HTTP ${answer.status}${error ? ` ${error}` : ""})`;
    if (error === "invalid_client" || answer.status === 401) return { ok: false, reason: "client_invalid", detail, calls: 1 };
    if (error === "invalid_scope" || answer.status === 400 || answer.status === 403) return { ok: false, reason: "refused", detail, calls: 1 };
    if (!answer.ok) return { ok: false, reason: "failed", detail: `token answered ${answer.status}`, calls: 1 };
    if (typeof body?.access_token !== "string" || !body.access_token) return { ok: false, reason: "failed", detail: "token answer without access_token", calls: 1 };
    const seconds = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 0;
    return { ok: true, value: body.access_token, expiresAt: now.getTime() + Math.max(seconds - 60, 0) * 1000 };
  }

  return {
    async token(api, now) {
      const token = kept.get(api);
      if (token && token.expiresAt > now.getTime()) return { ok: true, value: token.value, calls: 0 };
      const preferred = working.get(api);
      const scopes = preferred ? [preferred, ...FRANCE_TRAVAIL_SCOPES[api].filter((scope) => scope !== preferred)] : FRANCE_TRAVAIL_SCOPES[api];
      let calls = 0;
      let last: FranceTravailToken | null = null;
      for (const scope of scopes) {
        const answered = await ask(scope, now);
        calls++;
        if (answered.ok) {
          const { value } = answered;
          if ("expiresAt" in answered) kept.set(api, { value, expiresAt: answered.expiresAt });
          working.set(api, scope);
          return { ok: true, value, calls };
        }
        last = { ...answered, calls };
        // Only a scope refused is worth another try: a client unknown or an endpoint down stays so.
        if (answered.reason !== "refused") break;
      }
      return last!;
    },
    forget(api) {
      kept.delete(api);
    },
  };
}

/** How one API answered a token request: granted (`ok`), access refused by France Travail, or an error. */
export type FranceTravailApiAccess = "ok" | "refused" | "error";

export interface FranceTravailAccessCheck {
  /** `valid`: some API gave a token; `invalid`: the endpoint does not know the client; `unknown`: neither. */
  client: "valid" | "invalid" | "unknown";
  apis: Record<FranceTravailApi, FranceTravailApiAccess>;
  /** What went wrong, API by API (`offres_emploi: token refused (HTTP 400 invalid_scope)`); empty when nothing did. */
  detail: string;
}

/**
 * The connection test of a France Travail client: La Bonne Boite's token first (an invalid
 * client stops there, every API then in error), then each other API's, each on its own.
 */
export async function checkFranceTravailAccess(tokens: FranceTravailTokens, now: Date): Promise<FranceTravailAccessCheck> {
  const apis = {} as Record<FranceTravailApi, FranceTravailApiAccess>;
  const problems: string[] = [];
  for (const api of FRANCE_TRAVAIL_APIS) {
    const token = await tokens.token(api, now);
    if (!token.ok && token.reason === "client_invalid") {
      return { client: "invalid", apis: Object.fromEntries(FRANCE_TRAVAIL_APIS.map((each) => [each, "error"])) as typeof apis, detail: token.detail };
    }
    apis[api] = token.ok ? "ok" : token.reason === "refused" ? "refused" : "error";
    if (!token.ok) problems.push(`${api}: ${token.detail}`);
  }
  return { client: Object.values(apis).includes("ok") ? "valid" : "unknown", apis, detail: problems.join("; ") };
}
