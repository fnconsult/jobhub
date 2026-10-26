import { createAiLayerFromEnv } from "@jobhub/ai";
import { createMemoryUsageLog } from "@jobhub/ai/testing";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "../admin/back-office";
import { createPlatformSettingsBackOffice, type PlatformSettingsBackOffice } from "../admin/platform-settings-back-office";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { createSecretResolver, liveObject } from "../provider-secrets/resolver";
import { AI_ROUTING_NAMES, aiRoutingCheck, withPlatformSettings } from "./ai-routing";
import { migratePlatformSettings, platformSettingsReader, platformSettingsStore } from "./index";
import { createPlatformSettingsResolver } from "./resolver";

/** The server's env: Perplexity, the code's default web search provider, and Tavily have a key; Brave has none. */
const ENV = { PERPLEXITY_API_KEY: "pplx-test-key", TAVILY_API_KEY: "tvly-test-key", ANTHROPIC_ENDPOINT: "bedrock", AWS_BEARER_TOKEN_BEDROCK: "bedrock-token" };
const SEARCH_KEYS = ["PERPLEXITY_API_KEY", "TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY"];

describe.skipIf(!connectionString)("« Rendre actif » on Paramètres' Recherche web tab (#396; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let changes: PlatformSettingsBackOffice;
  let claire: BackOfficeActor;

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migratePlatformSettings(database);
    await migrateBackOfficeAudit(database);
    const unused = async () => {
      throw new Error("not used here");
    };
    backOffice = createBackOffice(database, {
      billing: { setPlanQuotas: unused, resetWeeklyUsage: unused, createPlan: unused, updatePlan: unused, movePlan: unused, checkStripeProduct: unused, plans: unused, createCoupon: unused, deactivateCoupon: unused, reactivateCoupon: unused },
      humanCoaches: { add: unused, retire: unused },
    });
    // As the web app wires it (admin/server.ts): an AI routing change is checked with the keys in use.
    changes = createPlatformSettingsBackOffice(platformSettingsStore(database, ENV, { check: aiRoutingCheck(() => ENV) }), backOffice);
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("sends the next web search to the provider made active, through the existing resolver, and records the change", async () => {
    const hosts: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      hosts.push(new URL(input instanceof Request ? input.url : input).host);
      return new Response("{}", { status: 401 });
    }) as typeof globalThis.fetch;
    const resolver = withPlatformSettings(
      createSecretResolver({ env: ENV, load: async () => ({}), log: () => {} }),
      createPlatformSettingsResolver({ env: ENV, load: platformSettingsReader(database).load, log: () => {} }),
    );
    await resolver.refresh();
    const ai = liveObject(resolver, [...AI_ROUTING_NAMES, ...SEARCH_KEYS], (env) => createAiLayerFromEnv(env, { fetch, usage: createMemoryUsageLog() }));
    const search = () => ai.searchCompany({ candidateId: null, employer: "Jobbbox", instructions: "{{entreprise}}" }).catch(() => null);

    await search();
    expect(await changes.set(claire, "AI_WEB_SEARCH_PROVIDER", "tavily")).toMatchObject({ ok: true, changed: true });
    // What the NOTIFY makes every process do (watch.ts).
    await resolver.refresh();
    await search();

    expect([...new Set(hosts)]).toEqual(["api.perplexity.ai", "api.tavily.com"]);
    const entries = await backOffice.journal({ section: "platform_settings" });
    expect(entries.map(({ actor, target, action, before, after }) => ({ email: actor.email, target, action, before, after }))).toEqual([
      { email: "claire@jobbbox.fr", target: "AI_WEB_SEARCH_PROVIDER", action: "updated", before: { value: "perplexity", source: "default" }, after: { value: "tavily", source: "back_office" } },
    ]);
  });

  it("refuses a provider whose key is missing, as any AI route the AI layer would not build, and records the refusal", async () => {
    expect(await changes.set(claire, "AI_WEB_SEARCH_PROVIDER", "brave")).toMatchObject({ ok: false, error: "refused", reason: "key_missing" });

    const [entry] = await backOffice.journal({ section: "platform_settings" });
    expect(entry).toMatchObject({ target: "AI_WEB_SEARCH_PROVIDER", outcome: "failed", failure: { reason: "key_missing", tried: "updated" } });
  });
});
