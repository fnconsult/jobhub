import { describe, expect, it, vi } from "vitest";
import { createSecretResolver, liveObject, rebuilding, type StoredSecrets } from "./resolver";

/** A database of Provider Secrets the test edits: what `load` reads. */
function fakeStore(initial: StoredSecrets = {}) {
  let stored = initial;
  const load = vi.fn(async () => stored);
  return {
    load,
    set(next: StoredSecrets) {
      stored = next;
    },
  };
}

const ENV = { MISTRAL_API_KEY: "env-mistral", STRIPE_SECRET_KEY: "sk_test_env", AI_SCORING_PROVIDER: "mistral" };

describe("the Provider Secrets resolver: database first, then env", () => {
  it("serves env until the database is read, then the database's value over env's", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "db-mistral", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV });

    expect(resolver.current().env.MISTRAL_API_KEY).toBe("env-mistral");
    await resolver.refresh();

    expect(resolver.current().env).toEqual({ ...ENV, MISTRAL_API_KEY: "db-mistral" });
    expect(resolver.current().source("MISTRAL_API_KEY")).toBe("database");
    expect(resolver.current().source("STRIPE_SECRET_KEY")).toBe("env");
    expect(resolver.current().source("PERPLEXITY_API_KEY")).toBe("missing");
  });

  it("falls back to env once the value is cleared from the database", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "db-mistral", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV });
    await resolver.refresh();

    store.set({});
    await resolver.refresh();

    expect(resolver.current().env.MISTRAL_API_KEY).toBe("env-mistral");
  });

  it("reads the database again once its cache is 60 s old, and not before", async () => {
    let clock = 0;
    const store = fakeStore({ MISTRAL_API_KEY: { value: "first", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV, now: () => clock });
    await resolver.refresh();
    store.set({ MISTRAL_API_KEY: { value: "second", row: "r2" } });

    clock = 59_000;
    resolver.current();
    await vi.waitFor(() => expect(store.load).toHaveBeenCalledTimes(1));
    clock = 60_000;
    expect(resolver.current().env.MISTRAL_API_KEY).toBe("first");

    await vi.waitFor(() => expect(resolver.current().env.MISTRAL_API_KEY).toBe("second"));
    expect(store.load).toHaveBeenCalledTimes(2);
  });

  it("keeps what it had when the database cannot be read, and says so without any value", async () => {
    const log = vi.fn();
    const store = fakeStore({ MISTRAL_API_KEY: { value: "db-mistral", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV, log });
    await resolver.refresh();

    store.load.mockRejectedValueOnce(new Error("connection refused"));
    await resolver.refresh();

    expect(resolver.current().env.MISTRAL_API_KEY).toBe("db-mistral");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
    expect(JSON.stringify(log.mock.calls)).not.toContain("db-mistral");
  });

  it("a refresh asked while a read is in flight reads once more after it: a save committed mid-read is not missed", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "old", row: "r1" } });
    let finishFirstRead!: () => void;
    const firstRead = new Promise<void>((resolve) => (finishFirstRead = resolve));
    // The first read has already read the old row; it answers once the save has committed.
    store.load.mockImplementationOnce(async () => {
      const read = { MISTRAL_API_KEY: { value: "old", row: "r1" } };
      await firstRead;
      return read;
    });
    const resolver = createSecretResolver({ load: store.load, env: ENV });

    const inFlight = resolver.refresh();
    store.set({ MISTRAL_API_KEY: { value: "new", row: "r2" } });
    const afterTheSave = resolver.refresh();
    finishFirstRead();

    expect((await inFlight).env.MISTRAL_API_KEY).toBe("old");
    expect((await afterTheSave).env.MISTRAL_API_KEY).toBe("new");
    expect(resolver.current().env.MISTRAL_API_KEY).toBe("new");
  });

  it("queues at most one more read, however many refreshes are asked meanwhile", async () => {
    const store = fakeStore();
    const resolver = createSecretResolver({ load: store.load, env: ENV });

    await Promise.all([resolver.refresh(), resolver.refresh(), resolver.refresh(), resolver.refresh()]);

    expect(store.load).toHaveBeenCalledTimes(2);
  });

  it("reads the database once for a single caller", async () => {
    const store = fakeStore();
    const resolver = createSecretResolver({ load: store.load, env: ENV });

    await resolver.refresh();

    expect(store.load).toHaveBeenCalledTimes(1);
  });
});

describe("a client built from Provider Secrets (liveObject)", () => {
  /** A provider client that remembers which key it was built with. */
  const client = (key: string | undefined) => ({ key, call: vi.fn(async () => `answered with ${key}`) });

  it("is rebuilt when one of its keys changes, and only then", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "k1", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV });
    await resolver.refresh();
    const build = vi.fn((env: Record<string, string | undefined>) => client(env.MISTRAL_API_KEY));
    const mistral = liveObject(resolver, ["MISTRAL_API_KEY"], build);

    expect(await mistral.call()).toBe("answered with k1");
    store.set({ MISTRAL_API_KEY: { value: "k1", row: "r1" }, STRIPE_SECRET_KEY: { value: "sk_test_db", row: "r9" } });
    await resolver.refresh();
    expect(await mistral.call()).toBe("answered with k1");
    expect(build).toHaveBeenCalledTimes(1);

    store.set({ MISTRAL_API_KEY: { value: "k2", row: "r2" } });
    await resolver.refresh();
    expect(await mistral.call()).toBe("answered with k2");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("retries a call refused with 401 or 403 once, with the key read afresh", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "revoked", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV });
    await resolver.refresh();
    const mistral = liveObject(resolver, ["MISTRAL_API_KEY"], (env) => ({
      call: async () => {
        if (env.MISTRAL_API_KEY === "revoked") throw Object.assign(new Error("mistral: HTTP 401"), { status: 401 });
        return `answered with ${env.MISTRAL_API_KEY}`;
      },
    }));
    // An Administrator has just replaced the key; the cache has not caught up yet.
    store.set({ MISTRAL_API_KEY: { value: "fresh", row: "r2" } });

    expect(await mistral.call()).toBe("answered with fresh");
  });

  it("does not retry when the key read afresh is the same, nor on other failures", async () => {
    const store = fakeStore({ MISTRAL_API_KEY: { value: "revoked", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: ENV });
    await resolver.refresh();
    const calls = vi.fn(async (status: number) => {
      throw Object.assign(new Error(`HTTP ${status}`), { status });
    });
    const mistral = liveObject(resolver, ["MISTRAL_API_KEY"], () => ({ call: calls }));

    await expect(mistral.call(403)).rejects.toThrow("HTTP 403");
    await expect(mistral.call(500)).rejects.toThrow("HTTP 500");

    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("recognises a refusal by statusCode (Stripe), an unauthorized reason (contact providers) or an SMTP authentication failure (535)", async () => {
    for (const refusal of [{ statusCode: 401 }, { reason: "unauthorized" }, { responseCode: 535 }, { code: "EAUTH" }]) {
      const store = fakeStore({ STRIPE_SECRET_KEY: { value: "old", row: "r1" } });
      const resolver = createSecretResolver({ load: store.load, env: ENV });
      await resolver.refresh();
      const stripe = liveObject(resolver, ["STRIPE_SECRET_KEY"], (env) => ({
        call: async () => {
          if (env.STRIPE_SECRET_KEY === "old") throw Object.assign(new Error("refused"), refusal);
          return "ok";
        },
      }));
      store.set({ STRIPE_SECRET_KEY: { value: "new", row: "r2" } });

      expect(await stripe.call()).toBe("ok");
    }
  });
});

describe("a value built from Provider Secrets (rebuilding)", () => {
  it("is built again when one of its keys changes, including to nothing (a client turned off)", async () => {
    const store = fakeStore({ FRANCE_TRAVAIL_CLIENT_SECRET: { value: "s1", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: {} });
    await resolver.refresh();
    const franceTravail = rebuilding(resolver, ["FRANCE_TRAVAIL_CLIENT_SECRET"], (env) => (env.FRANCE_TRAVAIL_CLIENT_SECRET ? { secret: env.FRANCE_TRAVAIL_CLIENT_SECRET } : null));

    const first = franceTravail();
    expect(franceTravail()).toBe(first);
    store.set({});
    await resolver.refresh();

    expect(franceTravail()).toBeNull();
  });
});

describe("a client that answers a refusal instead of throwing (liveObject's refused)", () => {
  it("is asked once more, with the key read afresh, when its answer says the key was refused (France Travail)", async () => {
    const store = fakeStore({ FRANCE_TRAVAIL_CLIENT_SECRET: { value: "revoked", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: {} });
    await resolver.refresh();
    const franceTravail = liveObject(
      resolver,
      ["FRANCE_TRAVAIL_CLIENT_SECRET"],
      (env) => ({
        search: async () => (env.FRANCE_TRAVAIL_CLIENT_SECRET === "revoked" ? { ok: false as const, reason: "refused" } : { ok: true as const, secret: env.FRANCE_TRAVAIL_CLIENT_SECRET }),
      }),
      { refused: (answer) => (answer as { reason?: string }).reason === "refused" },
    );
    store.set({ FRANCE_TRAVAIL_CLIENT_SECRET: { value: "fresh", row: "r2" } });

    expect(await franceTravail.search()).toEqual({ ok: true, secret: "fresh" });
  });

  it("keeps a refused answer when the key read afresh is the same", async () => {
    const store = fakeStore({ FRANCE_TRAVAIL_CLIENT_SECRET: { value: "revoked", row: "r1" } });
    const resolver = createSecretResolver({ load: store.load, env: {} });
    await resolver.refresh();
    const search = vi.fn(async () => ({ ok: false, reason: "refused" }));
    const franceTravail = liveObject(resolver, ["FRANCE_TRAVAIL_CLIENT_SECRET"], () => ({ search }), { refused: () => true });

    expect(await franceTravail.search()).toEqual({ ok: false, reason: "refused" });
    expect(search).toHaveBeenCalledTimes(1);
  });
});
