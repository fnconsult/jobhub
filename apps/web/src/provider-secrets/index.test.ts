import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackOffice, migrateBackOfficeAudit, type BackOffice, type BackOfficeActor } from "../admin/back-office";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { secretCipherFromEnv } from "./cipher";
import { createProviderSecrets, listenForProviderSecretChanges, migrateProviderSecrets, type ConnectionTester, type ProviderSecrets } from "./index";

const masterKey = () => `${randomBytes(32).toString("base64")}`;
const VALUE = "mistral-key-from-the-back-office-7f3a";
const ENV = { MISTRAL_API_KEY: "mistral-key-from-env-0000", STRIPE_SECRET_KEY: "sk_test_from_env_0123456789" };

describe.skipIf(!connectionString)("Provider Secrets, encrypted in the database (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let backOffice: BackOffice;
  let claire: BackOfficeActor;
  let keyring: string;
  let tester: ReturnType<typeof vi.fn<ConnectionTester>>;
  let secrets: ProviderSecrets;

  const providerSecrets = (env: Record<string, string | undefined> = { ...ENV, SECRETS_MASTER_KEYS: keyring }) =>
    createProviderSecrets(database, { cipher: secretCipherFromEnv(env), backOffice, env, testConnection: tester });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBackOfficeAudit(database);
    await migrateProviderSecrets(database);
    backOffice = createBackOffice(database, { billing: { setPlanQuotas: async () => ({}) as never }, humanCoaches: { add: async () => ({}) as never, retire: async () => null } });
    const cookie = await signInWithMagicLink(testAuth, "claire@jobbbox.fr");
    const { user } = await (await testAuth.request("/api/auth/get-session", { cookie })).json();
    claire = { id: user.id, email: user.email };
    keyring = `1:${masterKey()}`;
    tester = vi.fn<ConnectionTester>(async () => ({ ok: true }));
    secrets = providerSecrets();
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("lists every key with where its value comes from, and no value", async () => {
    const list = await secrets.list();

    expect(list.find((secret) => secret.name === "MISTRAL_API_KEY")).toEqual({
      name: "MISTRAL_API_KEY",
      provider: "mistral",
      source: "env",
      fingerprint: "0000",
      keyVersion: null,
      updatedBy: null,
      updatedAt: null,
    });
    expect(list.find((secret) => secret.name === "PERPLEXITY_API_KEY")).toMatchObject({ source: "missing", fingerprint: null });
    expect(JSON.stringify(list)).not.toContain(ENV.MISTRAL_API_KEY);
  });

  it("replacing a key tests it, keeps it encrypted, and uses it over env", async () => {
    const replaced = await secrets.replace(claire, "MISTRAL_API_KEY", `  ${VALUE}  `, { saveAnyway: false });

    expect(replaced).toEqual({ ok: true, test: "passed" });
    expect(tester).toHaveBeenCalledWith("mistral", expect.objectContaining({ MISTRAL_API_KEY: VALUE }));
    expect(await secrets.load()).toEqual({ MISTRAL_API_KEY: { value: VALUE, row: expect.any(String) } });
    expect((await secrets.list()).find((secret) => secret.name === "MISTRAL_API_KEY")).toEqual({
      name: "MISTRAL_API_KEY",
      provider: "mistral",
      source: "database",
      fingerprint: "7f3a",
      keyVersion: 1,
      updatedBy: "claire@jobbbox.fr",
      updatedAt: expect.any(Date),
    });
    const { rows } = await database.query("SELECT * FROM provider_secret");
    expect(JSON.stringify(rows)).not.toContain(VALUE);
    expect(rows[0].ciphertext.toString("utf8")).not.toContain(VALUE);
  });

  it("records the replacement in the Back Office Audit, never the value", async () => {
    await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });

    const journal = await backOffice.journal();
    expect(journal).toMatchObject([{ section: "provider_secrets", target: "MISTRAL_API_KEY", action: "replaced", before: null, after: null }]);
    const { rows } = await database.query("SELECT * FROM back_office_audit");
    expect(JSON.stringify(rows)).not.toContain(VALUE);
    expect(JSON.stringify(rows)).not.toContain("7f3a");
  });

  it("a key that fails its test is not saved, and the reason says nothing of it", async () => {
    tester.mockResolvedValue({ ok: false, detail: `HTTP 401 invalid key ${VALUE}` });

    const replaced = await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });

    expect(replaced).toEqual({ ok: false, error: "test_failed", detail: expect.any(String) });
    expect(JSON.stringify(replaced)).not.toContain(VALUE);
    expect(await secrets.load()).toEqual({});
    expect(await backOffice.journal()).toEqual([]);
  });

  it("a failed test's reason says nothing of any key in use either", async () => {
    tester.mockResolvedValue({ ok: false, detail: `refused; also tried ${ENV.MISTRAL_API_KEY} and ${ENV.STRIPE_SECRET_KEY}` });

    const replaced = await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });

    expect(replaced).toMatchObject({ ok: false, error: "test_failed" });
    expect(JSON.stringify(replaced)).not.toContain(ENV.MISTRAL_API_KEY);
    expect(JSON.stringify(replaced)).not.toContain(ENV.STRIPE_SECRET_KEY);
  });

  it("'save anyway' keeps a key that failed its test, and records that it did", async () => {
    tester.mockResolvedValue({ ok: false, detail: "HTTP 503" });

    expect(await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: true })).toEqual({ ok: true, test: "failed" });

    expect(await secrets.load()).toMatchObject({ MISTRAL_API_KEY: { value: VALUE } });
    expect(await backOffice.journal()).toMatchObject([{ target: "MISTRAL_API_KEY", action: "replaced_despite_failed_test", before: null, after: null }]);
  });

  it("clearing a key goes back to env, and is recorded", async () => {
    await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });

    expect(await secrets.clear(claire, "MISTRAL_API_KEY")).toEqual({ ok: true });
    expect(await secrets.clear(claire, "MISTRAL_API_KEY")).toEqual({ ok: true });

    expect(await secrets.load()).toEqual({});
    expect((await secrets.list()).find((secret) => secret.name === "MISTRAL_API_KEY")).toMatchObject({ source: "env", updatedBy: null });
    expect((await backOffice.journal()).map((entry) => entry.action)).toEqual(["cleared", "replaced"]);
  });

  it("refuses an unknown key, an empty value, and any key without SECRETS_MASTER_KEYS", async () => {
    expect(await secrets.replace(claire, "DATABASE_URL", "postgres://x", { saveAnyway: true })).toEqual({ ok: false, error: "unknown_secret" });
    expect(await secrets.replace(claire, "MISTRAL_API_KEY", "   ", { saveAnyway: true })).toEqual({ ok: false, error: "empty" });
    expect(await secrets.clear(claire, "AUTH_SECRET")).toEqual({ ok: false, error: "unknown_secret" });
    expect(await providerSecrets(ENV).replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: true })).toEqual({ ok: false, error: "no_master_key" });
    expect(tester).not.toHaveBeenCalled();
    expect(await backOffice.journal()).toEqual([]);
  });

  it("a row moved onto another key, or tampered with, is not used: env stands in, and the list says so", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });
    await secrets.replace(claire, "STRIPE_SECRET_KEY", "sk_test_from_the_back_office_99", { saveAnyway: false });
    // Someone with database access copies Mistral's ciphertext onto Stripe's row.
    await database.query(
      `UPDATE provider_secret s SET ciphertext = m.ciphertext, iv = m.iv, tag = m.tag FROM provider_secret m
       WHERE s.name = 'STRIPE_SECRET_KEY' AND m.name = 'MISTRAL_API_KEY'`,
    );

    expect(await secrets.load()).toEqual({ MISTRAL_API_KEY: { value: VALUE, row: expect.any(String) } });
    expect((await secrets.list()).find((secret) => secret.name === "STRIPE_SECRET_KEY")).toMatchObject({ source: "unreadable" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(VALUE);
    log.mockRestore();
  });

  it("re-encrypts every row under the newest master key, after which the old one can go", async () => {
    await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });
    await secrets.replace(claire, "STRIPE_SECRET_KEY", "sk_test_from_the_back_office_99", { saveAnyway: false });
    const v2 = masterKey();
    const rotated = providerSecrets({ ...ENV, SECRETS_MASTER_KEYS: `${keyring},2:${v2}` });
    const before = await rotated.load();

    expect(await rotated.reencrypt()).toBe(2);
    expect(await rotated.reencrypt()).toBe(0);

    const afterwards = providerSecrets({ ...ENV, SECRETS_MASTER_KEYS: `2:${v2}` });
    expect(await afterwards.load()).toEqual(before);
    expect((await afterwards.list()).filter((secret) => secret.source === "database").map((secret) => secret.keyVersion)).toEqual([2, 2]);
    expect(await backOffice.journal()).toHaveLength(2);
  });

  it("tests the key in use: the database's, else env's", async () => {
    expect(await secrets.test("STRIPE_SECRET_KEY")).toEqual({ ok: true });
    expect(tester).toHaveBeenLastCalledWith("stripe", expect.objectContaining({ STRIPE_SECRET_KEY: ENV.STRIPE_SECRET_KEY }));
    await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });
    tester.mockResolvedValue({ ok: false, detail: `refused ${VALUE}` });

    const tested = await secrets.test("MISTRAL_API_KEY");

    expect(tested).toEqual({ ok: false, detail: expect.not.stringContaining(VALUE) });
    expect(tester).toHaveBeenLastCalledWith("mistral", expect.objectContaining({ MISTRAL_API_KEY: VALUE }));
    expect(await secrets.test("PERPLEXITY_API_KEY")).toEqual({ ok: false, detail: "missing" });
  });

  it("tells every listener, web and worker, once a change is committed", async () => {
    const heard = vi.fn();
    const stop = await listenForProviderSecretChanges(database, heard);
    try {
      await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
      await secrets.clear(claire, "MISTRAL_API_KEY");
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(2));

      tester.mockResolvedValue({ ok: false, detail: "HTTP 401" });
      await secrets.replace(claire, "MISTRAL_API_KEY", VALUE, { saveAnyway: false });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(heard).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(heard.mock.calls)).not.toContain(VALUE);
    } finally {
      await stop();
    }
  });
});
