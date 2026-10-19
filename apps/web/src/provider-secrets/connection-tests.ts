/**
 * The connection test of each provider behind a Provider Secret: its cheapest
 * authenticated call, made with the keys in `env` (the one being saved over those
 * in use). AI providers list their models, France Travail gives an OAuth token,
 * Stripe its balance, Brevo its account (or its SMTP relay is verified), the contact-enrichment
 * provider answers its account call. Nothing is spent and nothing is stored.
 *
 * The details returned may quote the provider's answer; the store scrubs them of
 * the keys before they go anywhere.
 */
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
}

/** France Travail's token endpoint and scope, as the worker's client uses them (apps/worker/src/job-discovery/france-travail/api.ts). */
const FRANCE_TRAVAIL_TOKEN_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const FRANCE_TRAVAIL_SCOPE = "api_offresdemploiv2 o2dsoffre";

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

export function createConnectionTester(deps: ConnectionTesterDeps = {}): ConnectionTester {
  const fetch = deps.fetch ?? globalThis.fetch;
  const verifySmtp = deps.verifySmtp ?? defaultVerifySmtp;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  /** Calls `url`; ok on a 2xx answer, whose JSON `accept` may still turn down. */
  async function call(url: string, init: RequestInit, accept: (body: unknown) => string | null = () => null): Promise<ConnectionTestResult> {
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

  const bearer = (url: string, key: string) => call(url, { method: "GET", headers: { authorization: `Bearer ${key}`, accept: "application/json" } });

  const contactApi = (env: Env, provider: keyof typeof CONTACT_API) =>
    (env.CONTACT_ENRICHMENT_PROVIDER?.trim().toLowerCase() === provider && env.CONTACT_ENRICHMENT_API_URL?.trim()) || CONTACT_API[provider];

  const TESTS: Record<SecretProvider, (env: Env) => Promise<ConnectionTestResult>> = {
    async mistral(env) {
      const found = keys(env, "MISTRAL_API_KEY");
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer("https://api.mistral.ai/v1/models", found.MISTRAL_API_KEY);
    },
    async perplexity(env) {
      const found = keys(env, "PERPLEXITY_API_KEY");
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer("https://api.perplexity.ai/v1/models", found.PERPLEXITY_API_KEY);
    },
    async bedrock(env) {
      const found = keys(env, "AWS_BEARER_TOKEN_BEDROCK");
      const region = env.BEDROCK_REGION?.trim() || "eu-west-3";
      return "missing" in found ? failed(`missing ${found.missing}`) : bearer(`https://bedrock-mantle.${region}.api.aws/v1/models`, found.AWS_BEARER_TOKEN_BEDROCK);
    },
    async "france-travail"(env) {
      const found = keys(env, "FRANCE_TRAVAIL_CLIENT_ID", "FRANCE_TRAVAIL_CLIENT_SECRET");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(FRANCE_TRAVAIL_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: found.FRANCE_TRAVAIL_CLIENT_ID, client_secret: found.FRANCE_TRAVAIL_CLIENT_SECRET, scope: FRANCE_TRAVAIL_SCOPE }),
      });
    },
    async lusha(env) {
      const found = keys(env, "LUSHA_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      // The e2e override is Lusha's /v3 origin; the account call sits beside it.
      return call(`${contactApi(env, "lusha").replace(/\/v3\/?$/, "")}/account/usage`, { method: "GET", headers: { api_key: found.LUSHA_API_KEY, accept: "application/json" } });
    },
    async kaspr(env) {
      const found = keys(env, "KASPR_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(`${contactApi(env, "kaspr")}/keys/remaining`, { method: "GET", headers: { authorization: `Bearer ${found.KASPR_API_KEY}`, "accept-version": "v2.0" } });
    },
    async apollo(env) {
      const found = keys(env, "APOLLO_API_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      return call(`${contactApi(env, "apollo")}/auth/health`, { method: "GET", headers: { "x-api-key": found.APOLLO_API_KEY, "cache-control": "no-cache" } }, (body) =>
        (body as { is_logged_in?: unknown } | null)?.is_logged_in === true ? null : "Apollo answered, but not logged in with this key",
      );
    },
    async stripe(env) {
      const found = keys(env, "STRIPE_SECRET_KEY");
      if ("missing" in found) return failed(`missing ${found.missing}`);
      if (env.NODE_ENV !== "production" && found.STRIPE_SECRET_KEY.startsWith("sk_live_")) return failed("a live Stripe key is only allowed in production");
      // The webhook signing secret cannot be called: its shape is all there is to check.
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
      if (webhookSecret && !webhookSecret.startsWith("whsec_")) return failed("STRIPE_WEBHOOK_SECRET must start with whsec_");
      const origin = env.STRIPE_API_URL?.trim().replace(/\/$/, "") || "https://api.stripe.com";
      return bearer(`${origin}/v1/balance`, found.STRIPE_SECRET_KEY);
    },
    async brevo(env) {
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

  return (provider, env) => TESTS[provider](env);
}
