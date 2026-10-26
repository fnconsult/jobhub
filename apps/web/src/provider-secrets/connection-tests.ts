/**
 * The connection test of each provider behind a Provider Secret: its cheapest
 * authenticated call, made with the keys in `env` (the one being saved over those
 * in use). AI providers list their models, Brave answers one search of a single result,
 * Tavily its usage (no credit spent), France Travail gives each of its APIs' OAuth
 * tokens (La Bonne Boite first, which validates the client; each API's state is returned, #400),
 * Fantastic.jobs answers a search for no job (one API request, no Jobs credit),
 * Stripe its balance, Brevo its account (or its SMTP relay is verified), the contact-enrichment
 * provider answers its account call. Nothing is spent and nothing is stored.
 *
 * The details returned may quote the provider's answer; the store scrubs them of
 * the keys before they go anywhere. Each test that calls its provider is recorded as one
 * `connection_test` call to its Tool (#234): its outcome and duration, never a key.
 */
import { checkFranceTravailAccess, createFranceTravailTokens, recordingClient, recordingFetch, type ExternalApiLog, type ExternalApiProvider } from "@jobhub/shared";
import nodemailer from "nodemailer";
import type { SecretProvider } from "./catalog";
import type { ConnectionTester, ConnectionTestResult } from "./index";

type Env = Record<string, string | undefined>;

export interface ConnectionTesterDeps {
  /** Default: the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Checks an SMTP URL's server and credentials. Default: nodemailer's verify. */
  verifySmtp?: (smtpUrl: string) => Promise<void>;
  /** Default: 10 s per call. */
  timeoutMs?: number;
  /** Where each test's call is recorded, as a `connection_test` of its Tool. Default: nowhere. */
  externalApis?: ExternalApiLog;
}

/** The Tool each provider's connection test calls (TOOLS), by the id its calls are recorded under; Brevo's SMTP relay apart. */
const TOOL_OF: Record<SecretProvider, ExternalApiProvider> = {
  mistral: "mistral",
  perplexity: "perplexity",
  brave: "brave",
  tavily: "tavily",
  anthropic: "anthropic",
  bedrock: "anthropic_bedrock",
  "france-travail": "france_travail",
  "fantastic-jobs": "fantastic_jobs",
  lusha: "lusha",
  kaspr: "kaspr",
  apollo: "apollo",
  stripe: "stripe",
  brevo: "brevo",
};
const CONNECTION_TEST = "connection_test";

/**
 * Brave's web search, as packages/ai/src/providers/brave.ts calls it: one search of one result is its cheapest
 * authenticated call (it has no account call). Tavily's usage endpoint reads the key's credits without spending one.
 */
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_USAGE_URL = "https://api.tavily.com/usage";

/** Fantastic.jobs' API, as the worker's client uses it (apps/worker/src/job-discovery/fantastic-jobs/api.ts). */
const FANTASTIC_JOBS_API_URL = "https://data.fantastic.jobs/v1";

/** The contact-enrichment providers' API origins, and their e2e override. */
const CONTACT_API: Record<"lusha" | "kaspr" | "apollo", string> = {
  lusha: "https://api.lusha.com",
  kaspr: "https://api.developers.kaspr.io",
  apollo: "https://api.apollo.io/api/v1",
};

const ok: ConnectionTestResult = { ok: true };
const failed = (detail: string): ConnectionTestResult => ({ ok: false, detail });

/** The keys `names` from `env`, or the first one missing. */
function keys<Name extends string>(env: Env, ...names: Name[]): Record<Name, string> | { missing: Name } {
  const found = {} as Record<Name, string>;
  for (const name of names) {
    const value = env[name]?.trim();
    if (!value) return { missing: name };
    found[name] = value;
  }
  return found;
}

const defaultVerifySmtp = async (smtpUrl: string) => {
  const transport = nodemailer.createTransport(smtpUrl);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
};

/** What a provider's test calls through: recorded as its Tool's connection test, when they are recorded. */
interface Io {
  /** Calls `url`; ok on a 2xx answer, whose JSON `accept` may still turn down. */
  call(url: string, init: RequestInit, accept?: (body: unknown) => string | null): Promise<ConnectionTestResult>;
  bearer(url: string, key: string): Promise<ConnectionTestResult>;
  /** The fetch its calls go through, for a test that reads the answers itself. */
  fetch: typeof globalThis.fetch;
  verifySmtp(smtpUrl: string): Promise<void>;
}

export function createConnectionTester(deps: ConnectionTesterDeps = {}): ConnectionTester {
  const plainFetch = deps.fetch ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  const plainVerifySmtp = deps.verifySmtp ?? defaultVerifySmtp;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  /** The calls of `provider`'s test, each recorded when a log is given. */
  function io(provider: SecretProvider): Io {
    const { externalApis } = deps;
    const fetch = externalApis ? recordingFetch(plainFetch, externalApis, { provider: TOOL_OF[provider], operation: () => CONNECTION_TEST }) : plainFetch;
    const smtp = { [CONNECTION_TEST]: plainVerifySmtp };
    const verifySmtp = externalApis ? recordingClient(smtp, externalApis, { provider: "brevo_smtp", answeredStatus: null })[CONNECTION_TEST] : plainVerifySmtp;
    const call = (url: string, init: RequestInit, accept?: (body: unknown) => string | null) => callWith(fetch, url, init, accept);
    return {
      call,
      bearer: (url, key) => call(url, { method: "GET", headers: { authorization: `Bearer ${key}`, accept: "application/json" } }),
      fetch: fetch as typeof globalThis.fetch,
      verifySmtp,
    };
  }

  async function callWith(
    fetch: (url: string, init: RequestInit) => Promise<Response>,
    url: string,
    init: RequestInit,
    accept: (body: unknown) => string | null = () => null,
  ): Promise<ConnectionTestResult> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      return failed(`network error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) return failed(`HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`.trim());
    const refusal = accept(await response.json().catch(() => null));
    return refusal ? failed(refusal) : ok;
  }

  const contactApi = (env: Env, provider: keyof typeof CONTACT_API) =>
    (env.CONTACT_ENRICHMENT_PROVIDER?.trim().toLowerCase() === provider && env.CONTACT_ENRICHMENT_API_URL?.trim()) || CONTACT_API[provider];

  const TESTS: Record<SecretProvider, (env: Env, io: Io) => Promise<ConnectionTestResult>> = {
    async mistral(env, { bearer }) {
      const found = keys(env, "MISTRAL_API_KEY");
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer("https://api.mistral.ai/v1/models", found.MISTRAL_API_KEY);
    },
    async perplexity(env, { bearer }) {
      const found = keys(env, "PERPLEXITY_API_KEY");
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer("https://api.perplexity.ai/v1/models", found.PERPLEXITY_API_KEY);
    },
    async brave(env, { call }) {
      const found = keys(env, "BRAVE_SEARCH_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(`${BRAVE_SEARCH_URL}?${new URLSearchParams({ q: "jobbbox", count: "1" })}`, {
        method: "GET",
        headers: { "x-subscription-token": found.BRAVE_SEARCH_API_KEY, accept: "application/json" },
      });
    },
    async tavily(env, { bearer }) {
      const found = keys(env, "TAVILY_API_KEY");
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer(TAVILY_USAGE_URL, found.TAVILY_API_KEY);
    },
    async anthropic(env, { call }) {
      const found = keys(env, "ANTHROPIC_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call("https://api.anthropic.com/v1/models", { method: "GET", headers: { "x-api-key": found.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", accept: "application/json" } });
    },
    async bedrock(env, { bearer }) {
      const found = keys(env, "AWS_BEARER_TOKEN_BEDROCK");
      const region = env.BEDROCK_REGION?.trim() || "eu-north-1";
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer(`https://bedrock-mantle.${region}.api.aws/v1/models`, found.AWS_BEARER_TOKEN_BEDROCK);
    },
    async "france-travail"(env, { fetch }) {
      const found = keys(env, "FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      // Each API's own token, never their scopes mixed (#400): passes when the client is valid, whatever API it lacks.
      const tokens = createFranceTravailTokens({ clientId: found.FRANCE_TRAVAIL_CLIENT_ID, clientSecret: found.FRANCE_TRAVAIL_CLIENT_SECRET, fetch, timeoutMs });
      const { client, apis, detail } = await checkFranceTravailAccess(tokens, new Date());
      return client === "valid" ? { ok: true, apis } : { ok: false, detail: detail || "no France Travail API gave a token", apis };
    },
    async "fantastic-jobs"(env, { bearer }) {
      const found = keys(env, "FANTASTIC_JOBS_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      const api = env.FANTASTIC_JOBS_API_URL?.trim().replace(/\/+$/, "") || FANTASTIC_JOBS_API_URL;
      // No job has id 0, and at most 1 could come: one API request is spent, no Jobs credit.
      return bearer(`${api}/active-ats?${new URLSearchParams({ id: "0", limit: "1", time_frame: "1h" })}`, found.FANTASTIC_JOBS_API_KEY);
    },
    async lusha(env, { call }) {
      const found = keys(env, "LUSHA_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      // The e2e override is Lusha's /v3 origin; the account call sits beside it.
      return call(`${contactApi(env, "lusha").replace(/\/v3\/?$/, "")}/account/usage`, { method: "GET", headers: { api_key: found.LUSHA_API_KEY, accept: "application/json" } });
    },
    async kaspr(env, { call }) {
      const found = keys(env, "KASPR_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(`${contactApi(env, "kaspr")}/keys/remaining`, { method: "GET", headers: { authorization: `Bearer ${found.KASPR_API_KEY}`, "accept-version": "v2.0" } });
    },
    async apollo(env, { call }) {
      const found = keys(env, "APOLLO_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(`${contactApi(env, "apollo")}/auth/health`, { method: "GET", headers: { "x-api-key": found.APOLLO_API_KEY, "cache-control": "no-cache" } }, (body) =>
        (body as { is_logged_in?: unknown } | null)?.is_logged_in === true ? null : "Apollo answered, but not logged in with this key",
      );
    },
    async stripe(env, { bearer }) {
      const found = keys(env, "STRIPE_SECRET_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      if (env.NODE_ENV !== "production" && found.STRIPE_SECRET_KEY.startsWith("sk_live_")) return failed("a live Stripe key is only allowed in production");
      // The webhook signing secret cannot be called: its shape is all there is to check.
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
      if (webhookSecret && !webhookSecret.startsWith("whsec_")) return failed("STRIPE_WEBHOOK_SECRET must start with whsec_");
      const origin = env.STRIPE_API_URL?.trim().replace(/\/$/, "") || "https://api.stripe.com";
      return bearer(`${origin}/v1/balance`, found.STRIPE_SECRET_KEY);
    },
    async brevo(env, { call, verifySmtp }) {
      // The API key is the one the mailer uses when both are set (auth/mailers.ts).
      const apiKey = env.BREVO_API_KEY?.trim();
      if (apiKey) {
        const origin = env.BREVO_API_URL?.trim().replace(/\/$/, "") || "https://api.brevo.com/v3";
        return call(`${origin}/account`, { method: "GET", headers: { "api-key": apiKey, accept: "application/json" } });
      }
      const found = keys(env, "SMTP_URL");
      if ("missing" in found) return failed("missing BREVO_API_KEY or SMTP_URL");
      try {
        await verifySmtp(found.SMTP_URL);
        return ok;
      } catch (error) {
        return failed(`SMTP: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };

  return (provider, env) => TESTS[provider](env, io(provider));
}
