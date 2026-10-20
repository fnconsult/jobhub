import { generateKeyPairSync, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "../admin/back-office";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { secretCipherFromEnv } from "../provider-secrets/cipher";
import { listenForNotifications } from "../database/listen";
import { createProviderSecrets, migrateProviderSecrets } from "../provider-secrets/index";
import type { ExternalApiCall } from "@jobhub/shared";
import { configurationFromEnv, createSignInProviders, fetchDiscoveryDocument, migrateSignInProviders, SIGN_IN_PROVIDERS_CHANNEL, type SignInProviders } from "./index";

type Env = Record<string, string | undefined>;

const masterKey = () => `1:${randomBytes(32).toString("base64")}`;
const GOOGLE_ENV = { GOOGLE_CLIENT_ID: "env-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "env-google-secret-0001" };
const OIDC_SECRET = "oidc-client-secret-from-the-back-office-9f2c";
const p8 = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();

const oidc = (overrides: Record<string, unknown> = {}) => ({
  type: "oidc",
  id: "jobbbox-sso",
  displayName: "Jobbbox SSO",
  clientId: "jobbbox-web",
  discoveryUrl: "https://sso.jobbbox.fr/.well-known/openid-configuration",
  enabled: false,
  shownToCandidates: false,
  allowedForAdministrators: true,
  trustedForLinking: false,
  secrets: { clientSecret: OIDC_SECRET },
  ...overrides,
});

const apple = (overrides: Record<string, unknown> = {}) => ({
  type: "apple",
  displayName: "Apple",
  clientId: "fr.jobbbox.signin",
  enabled: false,
  shownToCandidates: true,
  allowedForAdministrators: true,
  secrets: { teamId: "ABCDE12345", keyId: "KEY1234567", privateKey: p8 },
  ...overrides,
});

describe("configurationFromEnv", () => {
  it("is the env's Google client, shown to Candidates and allowed for Administrators, or nothing", () => {
    expect(configurationFromEnv(GOOGLE_ENV).providers).toEqual([
      expect.objectContaining({ id: "google", type: "google", clientId: GOOGLE_ENV.GOOGLE_CLIENT_ID, clientSecret: GOOGLE_ENV.GOOGLE_CLIENT_SECRET, enabled: true, shownToCandidates: true, allowedForAdministrators: true, trustedForLinking: true }),
    ]);
    expect(configurationFromEnv({}).providers).toEqual([]);
  });
});

const DISCOVERY = { issuer: "https://sso.jobbbox.fr", authorization_endpoint: "https://sso.jobbbox.fr/authorize", token_endpoint: "https://sso.jobbbox.fr/token" };

describe("fetchDiscoveryDocument", () => {
  it("is the issuer's discovery document", async () => {
    const fetch = vi.fn(async () => Response.json(DISCOVERY));
    expect(await fetchDiscoveryDocument("https://sso.jobbbox.fr/.well-known/openid-configuration", { fetch })).toEqual(DISCOVERY);
  });

  it("is null after the time limit when the issuer does not answer, rather than wait", async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
    const started = Date.now();
    expect(await fetchDiscoveryDocument("https://slow.example/.well-known/openid-configuration", { fetch: hanging, timeoutMs: 50, log: () => {} })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("is recorded as one discovery call to the OIDC Tool, a failed one too, never the issuer's address (#234)", async () => {
    const calls: ExternalApiCall[] = [];
    const externalApis = { record: (call: ExternalApiCall) => void calls.push(call) };

    await fetchDiscoveryDocument("https://sso.jobbbox.fr/tenant-42/.well-known/openid-configuration", { fetch: async () => Response.json(DISCOVERY), externalApis });
    await fetchDiscoveryDocument("https://sso.jobbbox.fr/tenant-42/.well-known/openid-configuration", { fetch: async () => new Response("", { status: 503 }), externalApis, log: () => {} });

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "oidc", operation: "discovery", ok: true, httpStatus: 200 },
      { provider: "oidc", operation: "discovery", ok: false, httpStatus: 503 },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/jobbbox|tenant|well-known/);
  });

  it("is null for an answer that is not a usable discovery document", async () => {
    for (const answer of [new Response("nope", { status: 500 }), Response.json({ issuer: "not a url", authorization_endpoint: "x" }), Response.json({ issuer: "https://sso.jobbbox.fr" })]) {
      expect(await fetchDiscoveryDocument("https://sso.jobbbox.fr/.well-known/openid-configuration", { fetch: async () => answer, log: () => {} })).toBeNull();
    }
  });
});

describe.skipIf(!connectionString)("Sign-in Providers in the database (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let claire: BackOfficeActor;
  let keyring: string;
  let providers: SignInProviders;
  let now: Date;

  const discoveries: string[] = [];
  const signInProviders = (env: Env = { SECRETS_MASTER_KEYS: keyring }) =>
    createSignInProviders(database, {
      cipher: secretCipherFromEnv(env),
      backOffice,
      env,
      now: () => now,
      fetchDiscovery: async (url) => {
        discoveries.push(url);
        return url.includes("unreachable") ? null : DISCOVERY;
      },
    });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBackOfficeAudit(database);
    await migrateProviderSecrets(database);
    await migrateSignInProviders(database, {});
    backOffice = createBackOffice(database, { billing: { setPlanQuotas: async () => ({}) as never, resetWeeklyUsage: async () => ({}) as never, createPlan: async () => ({}) as never, updatePlan: async () => ({}) as never, movePlan: async () => ({}) as never, checkStripeProduct: async () => null, plans: async () => [], createCoupon: async () => ({}) as never, deactivateCoupon: async () => ({}) as never, reactivateCoupon: async () => ({}) as never }, humanCoaches: { add: async () => ({}) as never, retire: async () => null } });
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
    keyring = masterKey();
    now = new Date("2026-10-17T08:00:00Z");
    discoveries.length = 0;
    providers = signInProviders();
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("the env's Google client after the deployment", () => {
    it("is seeded as a provider, shown to Candidates and allowed for Administrators, its secret still from env", async () => {
      await migrateSignInProviders(database, GOOGLE_ENV);
      const withEnv = signInProviders({ ...GOOGLE_ENV, SECRETS_MASTER_KEYS: keyring });

      expect(await withEnv.list()).toEqual([
        expect.objectContaining({
          id: "google",
          clientId: GOOGLE_ENV.GOOGLE_CLIENT_ID,
          enabled: true,
          shownToCandidates: true,
          allowedForAdministrators: true,
          trustedForLinking: true,
          callbackPath: "/api/auth/callback/google",
          secrets: [{ field: "clientSecret", source: "env" }],
        }),
      ]);
      expect((await withEnv.load()).providers).toEqual([expect.objectContaining({ id: "google", clientSecret: GOOGLE_ENV.GOOGLE_CLIENT_SECRET, enabled: true })]);
    });

    it("is seeded once: removed in the Back Office, it stays removed", async () => {
      await migrateSignInProviders(database, GOOGLE_ENV);
      const withEnv = signInProviders({ ...GOOGLE_ENV, SECRETS_MASTER_KEYS: keyring });
      expect(await withEnv.remove(claire, "google")).toEqual({ ok: true });

      await migrateSignInProviders(database, GOOGLE_ENV);

      expect(await withEnv.list()).toEqual([]);
      expect((await withEnv.load()).providers).toEqual([]);
    });

    it("is env's Google alone while the table does not exist yet", async () => {
      await database.query("DROP TABLE sign_in_provider");
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect((await signInProviders(GOOGLE_ENV).load()).providers.map((provider) => provider.id)).toEqual(["google"]);
      log.mockRestore();
    });
  });

  it("adds an OIDC provider with its client secret encrypted, never listed, and registered for a test sign-in", async () => {
    expect(await providers.save(claire, oidc())).toEqual({ ok: true, id: "jobbbox-sso" });

    const [listed] = await providers.list();
    expect(listed).toMatchObject({
      id: "jobbbox-sso",
      type: "oidc",
      displayName: "Jobbbox SSO",
      enabled: false,
      callbackPath: "/api/auth/callback/jobbbox-sso",
      secrets: [{ field: "clientSecret", source: "database" }],
      testedAt: null,
      updatedBy: "claire@jobbbox.fr",
    });
    expect(JSON.stringify(await providers.list())).not.toContain(OIDC_SECRET);
    const { rows } = await database.query("SELECT * FROM provider_secret");
    expect(JSON.stringify(rows)).not.toContain(OIDC_SECRET);
    expect((await providers.load()).providers).toEqual([expect.objectContaining({ id: "jobbbox-sso", clientSecret: OIDC_SECRET, enabled: false })]);
  });

  it("keeps its secrets out of the Clés section and moves them to a new master key with the Provider Secrets", async () => {
    await providers.save(claire, oidc());
    const env = { SECRETS_MASTER_KEYS: `${keyring},2:${randomBytes(32).toString("base64")}` };
    const providerSecrets = createProviderSecrets(database, { cipher: secretCipherFromEnv(env), backOffice, env, testConnection: async () => ({ ok: true }) });

    expect((await providerSecrets.list()).filter((secret) => secret.source !== "missing")).toEqual([]);
    expect(await providerSecrets.reencrypt()).toBe(1);

    expect((await signInProviders({ SECRETS_MASTER_KEYS: `2:${env.SECRETS_MASTER_KEYS.split(",")[1]!.slice(2)}` }).load()).providers[0]).toMatchObject({ clientSecret: OIDC_SECRET });
  });

  it("is enabled only once a test sign-in has passed since its credentials last changed", async () => {
    await providers.save(claire, oidc());

    expect(await providers.save(claire, oidc({ enabled: true, secrets: {} }))).toEqual({ ok: false, error: "not_tested" });
    const started = await providers.startTestSignIn(claire, "jobbbox-sso");
    if (!started.ok) throw new Error(started.error);
    expect(await providers.completeTestSignIn("jobbbox-sso", started.nonce)).toBe(true);
    expect(await providers.save(claire, oidc({ enabled: true, secrets: {} }))).toEqual({ ok: true, id: "jobbbox-sso" });

    // Credentials changed while enabled: it stays enabled, but a new test is due before enabling it again.
    expect(await providers.save(claire, oidc({ enabled: true, secrets: { clientSecret: "rotated-secret-0000000000" } }))).toEqual({ ok: true, id: "jobbbox-sso" });
    expect((await providers.list())[0]).toMatchObject({ enabled: true, testedAt: null });
    await providers.save(claire, oidc({ enabled: false, secrets: {} }));
    expect(await providers.save(claire, oidc({ enabled: true, secrets: {} }))).toEqual({ ok: false, error: "not_tested" });
    expect((await providers.load()).providers[0]).toMatchObject({ clientSecret: "rotated-secret-0000000000" });
  });

  describe("a test sign-in", () => {
    it("is started by a super-admin from Connexion, registers the provider meanwhile, and passes once, with its nonce only", async () => {
      await providers.save(claire, oidc());
      expect((await providers.load()).providers[0]).toMatchObject({ enabled: false, testPending: false });

      const started = await providers.startTestSignIn(claire, "jobbbox-sso");
      if (!started.ok) throw new Error(started.error);
      expect(started.nonce.length).toBeGreaterThanOrEqual(32);
      expect((await providers.load()).providers[0]).toMatchObject({ testPending: true });
      // The nonce itself is never stored.
      expect(JSON.stringify((await database.query("SELECT * FROM sign_in_provider")).rows)).not.toContain(started.nonce);

      expect(await providers.completeTestSignIn("jobbbox-sso", "a-nonce-nobody-issued")).toBe(false);
      expect(await providers.completeTestSignIn("google", started.nonce)).toBe(false);
      expect((await providers.list())[0]!.testedAt).toBeNull();
      expect(await providers.completeTestSignIn("jobbbox-sso", started.nonce)).toBe(true);
      expect(await providers.completeTestSignIn("jobbbox-sso", started.nonce)).toBe(false);

      expect((await providers.list())[0]!.testedAt).toEqual(now);
      expect((await providers.load()).providers[0]).toMatchObject({ testPending: false });
    });

    it("expires ten minutes after it was started", async () => {
      await providers.save(claire, oidc());
      const started = await providers.startTestSignIn(claire, "jobbbox-sso");
      if (!started.ok) throw new Error(started.error);

      now = new Date(now.getTime() + 11 * 60_000);

      expect((await providers.load()).providers[0]).toMatchObject({ testPending: false });
      expect(await providers.completeTestSignIn("jobbbox-sso", started.nonce)).toBe(false);
    });

    it("is recorded in the Back Office Audit, as the super-admin who started it", async () => {
      await providers.save(claire, oidc());
      const started = await providers.startTestSignIn(claire, "jobbbox-sso");
      if (!started.ok) throw new Error(started.error);
      await providers.completeTestSignIn("jobbbox-sso", started.nonce);

      const [entry] = await backOffice.journal({ section: "sign_in_providers" });
      expect(entry).toMatchObject({ target: "jobbbox-sso", action: "tested", actor: { candidateId: claire.id, email: "claire@jobbbox.fr" } });
    });

    it("is not started for a provider already enabled, nor one that does not exist", async () => {
      expect(await providers.startTestSignIn(claire, "jobbbox-sso")).toEqual({ ok: false, error: "unknown_provider" });
      await providers.save(claire, oidc());
      await database.query("UPDATE sign_in_provider SET enabled = true WHERE id = 'jobbbox-sso'");
      expect(await providers.startTestSignIn(claire, "jobbbox-sso")).toEqual({ ok: false, error: "already_enabled" });
    });

    it("changes the configuration's version when it starts and when it passes, so the provider is registered then unregistered", async () => {
      await providers.save(claire, oidc());
      const before = (await providers.load()).version;
      const started = await providers.startTestSignIn(claire, "jobbbox-sso");
      if (!started.ok) throw new Error(started.error);
      const during = (await providers.load()).version;
      await providers.completeTestSignIn("jobbbox-sso", started.nonce);

      expect(during).not.toBe(before);
      expect((await providers.load()).version).not.toBe(during);
    });
  });

  it("fetches an OIDC issuer's discovery document only for a provider in use or under test, and leaves out one that does not answer", async () => {
    await providers.save(claire, oidc());
    await providers.save(claire, oidc({ id: "partner-sso", displayName: "Partner", discoveryUrl: "https://unreachable.partner.example/.well-known/openid-configuration" }));

    await providers.load();
    expect(discoveries).toEqual([]);

    await database.query("UPDATE sign_in_provider SET enabled = true");
    const { providers: loaded } = await providers.load();
    expect(loaded.find((provider) => provider.id === "jobbbox-sso")).toMatchObject({ discovery: DISCOVERY });
    expect(loaded.find((provider) => provider.id === "partner-sso")?.discovery).toBeUndefined();
  });

  it("records every change in the Back Office Audit, never a secret", async () => {
    await providers.save(claire, oidc());
    await providers.save(claire, oidc({ displayName: "SSO Jobbbox", secrets: { clientSecret: "rotated-secret-0000000000" } }));
    await providers.setRequireSsoForAdministrators(claire, true);
    await providers.remove(claire, "jobbbox-sso");

    const journal = await backOffice.journal({ section: "sign_in_providers" });
    expect(journal.map(({ target, action }) => [target, action])).toEqual([
      ["jobbbox-sso", "removed"],
      ["require_sso_for_administrators", "updated"],
      ["jobbbox-sso", "updated"],
      ["jobbbox-sso", "added"],
    ]);
    expect(journal[2]).toMatchObject({ before: expect.objectContaining({ displayName: "Jobbbox SSO" }), after: expect.objectContaining({ displayName: "SSO Jobbbox", secretsReplaced: ["clientSecret"] }) });
    expect(journal[1]).toMatchObject({ before: false, after: true });
    const { rows } = await database.query("SELECT * FROM back_office_audit");
    expect(JSON.stringify(rows)).not.toContain(OIDC_SECRET);
    expect(JSON.stringify(rows)).not.toContain("rotated-secret");
  });

  it("removing a provider removes its secrets", async () => {
    await providers.save(claire, oidc());

    expect(await providers.remove(claire, "jobbbox-sso")).toEqual({ ok: true });
    expect(await providers.remove(claire, "jobbbox-sso")).toEqual({ ok: false, error: "unknown_provider" });

    expect((await database.query("SELECT * FROM provider_secret")).rows).toEqual([]);
    expect((await providers.load()).providers).toEqual([]);
  });

  it("Require SSO for Administrators is off by default", async () => {
    expect(await providers.settings()).toEqual({ requireSsoForAdministrators: false });
    await providers.setRequireSsoForAdministrators(claire, true);

    expect(await providers.settings()).toEqual({ requireSsoForAdministrators: true });
    expect((await providers.load()).requireSsoForAdministrators).toBe(true);
  });

  it("changes its configuration's version on every change, so the sign-in is rebuilt", async () => {
    const first = (await providers.load()).version;
    await providers.save(claire, oidc());
    const second = (await providers.load()).version;
    await providers.setRequireSsoForAdministrators(claire, true);
    const third = (await providers.load()).version;

    expect(new Set([first, second, third]).size).toBe(3);
    expect(second).not.toContain(OIDC_SECRET);
    expect((await providers.load()).version).toBe(third);
  });

  it("announces every committed change", async () => {
    const heard = vi.fn();
    const stop = await listenForNotifications(database, SIGN_IN_PROVIDERS_CHANNEL, heard);
    try {
      await providers.save(claire, oidc());
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
      await providers.setRequireSsoForAdministrators(claire, true);
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(2));
      await providers.save(claire, oidc({ discoveryUrl: "not a url" }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(heard).toHaveBeenCalledTimes(2);
    } finally {
      await stop();
    }
  });

  it("refuses what it cannot use, saving nothing", async () => {
    expect(await providers.save(claire, oidc({ type: "github" }))).toEqual({ ok: false, error: "invalid_type" });
    expect(await providers.save(claire, oidc({ id: "Google" }))).toEqual({ ok: false, error: "invalid_id" });
    expect(await providers.save(claire, oidc({ id: "magic-link" }))).toEqual({ ok: false, error: "invalid_id" });
    expect(await providers.save(claire, oidc({ clientId: " " }))).toEqual({ ok: false, error: "invalid_client_id" });
    expect(await providers.save(claire, oidc({ displayName: "" }))).toEqual({ ok: false, error: "invalid_display_name" });
    expect(await providers.save(claire, oidc({ discoveryUrl: "http://sso.example.com/.well-known/openid-configuration" }))).toEqual({ ok: false, error: "invalid_discovery_url" });
    expect(await providers.save(claire, oidc({ secrets: {} }))).toEqual({ ok: false, error: "missing_secret" });
    expect(await providers.save(claire, oidc({ type: "microsoft", tenantId: "not a tenant!" }))).toEqual({ ok: false, error: "invalid_tenant" });
    expect(await signInProviders({}).save(claire, oidc())).toEqual({ ok: false, error: "no_master_key" });

    expect(await backOffice.journal({ section: "sign_in_providers" })).toEqual([]);
    expect(await providers.list()).toEqual([]);
  });

  it("takes a social provider's type as its id, trusting it for linking", async () => {
    expect(await providers.save(claire, { ...oidc({ type: "microsoft", id: undefined, tenantId: "consumers", trustedForLinking: false }), discoveryUrl: undefined })).toEqual({ ok: true, id: "microsoft" });

    expect((await providers.list())[0]).toMatchObject({ id: "microsoft", tenantId: "consumers", trustedForLinking: true, discoveryUrl: null });
  });

  describe("Apple", () => {
    it("signs its client secret from the .p8 key as soon as it is saved, and shows when it is signed again", async () => {
      expect(await providers.save(claire, apple())).toEqual({ ok: true, id: "apple" });

      const [listed] = await providers.list();
      expect(listed).toMatchObject({
        id: "apple",
        secrets: [
          { field: "teamId", source: "database" },
          { field: "keyId", source: "database" },
          { field: "privateKey", source: "database" },
        ],
        apple: { generatedAt: now, expiresAt: new Date("2026-12-16T08:00:00Z"), nextRegenerationAt: new Date("2026-11-16T08:00:00Z"), failedAt: null },
      });
      expect(JSON.stringify(await providers.list())).not.toContain("BEGIN PRIVATE KEY");
      const [inUse] = (await providers.load()).providers;
      expect(inUse?.clientSecret.split(".")).toHaveLength(3);
    });

    it("refuses a .p8 key that does not sign", async () => {
      expect(await providers.save(claire, apple({ secrets: { teamId: "ABCDE12345", keyId: "KEY1234567", privateKey: "not a key" } }))).toEqual({ ok: false, error: "invalid_apple_key" });
    });

    it("signs a new client secret once a month, and says which failed", async () => {
      await providers.save(claire, apple());
      const first = (await providers.load()).providers[0]!.clientSecret;

      now = new Date("2026-11-01T08:00:00Z");
      expect(await providers.regenerateAppleClientSecrets()).toEqual({ regenerated: [], failed: [] });
      now = new Date("2026-11-16T08:00:00Z");
      expect(await providers.regenerateAppleClientSecrets()).toEqual({ regenerated: ["apple"], failed: [] });
      expect((await providers.load()).providers[0]!.clientSecret).not.toBe(first);

      // The .p8 key's row no longer opens (its master key was removed): the regeneration fails, and says so.
      now = new Date("2026-12-17T08:00:00Z");
      const withAnotherKey = signInProviders({ SECRETS_MASTER_KEYS: masterKey() });
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await withAnotherKey.regenerateAppleClientSecrets()).toEqual({ regenerated: [], failed: [{ id: "apple", reason: "missing_secret", firstFailure: true }] });
      expect((await providers.list())[0]!.apple).toMatchObject({ failedAt: now });
      // The next day it fails again: the same failure streak, the super-admins were told already.
      const firstFailedAt = now;
      now = new Date("2026-12-18T08:00:00Z");
      expect(await withAnotherKey.regenerateAppleClientSecrets()).toEqual({ regenerated: [], failed: [{ id: "apple", reason: "missing_secret", firstFailure: false }] });
      log.mockRestore();
      expect((await providers.list())[0]!.apple).toMatchObject({ failedAt: firstFailedAt });
      // Signed again: the streak is over, a later failure starts a new one.
      expect(await providers.regenerateAppleClientSecrets()).toEqual({ regenerated: ["apple"], failed: [] });
      expect((await providers.list())[0]!.apple).toMatchObject({ failedAt: null });
    });
  });
});
