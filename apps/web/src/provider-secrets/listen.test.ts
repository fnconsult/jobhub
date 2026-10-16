import { EventEmitter } from "node:events";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { listenForProviderSecretChanges, PROVIDER_SECRETS_CHANNEL } from "./index";

/** A pooled connection the test drives: LISTEN may fail, the connection may drop. */
class FakeClient extends EventEmitter {
  released: unknown[] = [];
  constructor(private readonly listenFails = false) {
    super();
  }
  async query(sql: string) {
    if (sql.startsWith("LISTEN") && this.listenFails) throw new Error("LISTEN refused");
    return { rows: [] };
  }
  release(error?: unknown) {
    this.released.push(error ?? "released");
  }
  notify() {
    this.emit("notification", { channel: PROVIDER_SECRETS_CHANNEL, payload: "" });
  }
}

/** A pool whose `connect` answers each attempt in turn: a client, or a failure. */
function fakePool(attempts: (FakeClient | Error)[]) {
  const connect = vi.fn(async () => {
    const next = attempts.shift();
    if (!next) throw new Error("no more connections");
    if (next instanceof Error) throw next;
    return next;
  });
  return { pool: { connect } as unknown as Pool, connect };
}

const quiet = { log: () => {}, reconnectMs: 5, maxReconnectMs: 20 };

describe("listening for Provider Secret changes (NOTIFY)", () => {
  it("hears a change", async () => {
    const client = new FakeClient();
    const heard = vi.fn();
    const stop = await listenForProviderSecretChanges(fakePool([client]).pool, heard, quiet);

    client.notify();

    expect(heard).toHaveBeenCalledTimes(1);
    await stop();
    expect(client.released).toEqual(["released"]);
  });

  it("keeps trying, with backoff, when the first listen fails: no connection, then LISTEN refused (that client is released)", async () => {
    const refusing = new FakeClient(true);
    const listening = new FakeClient();
    const { pool, connect } = fakePool([new Error("too many clients"), refusing, listening]);
    const heard = vi.fn();

    const stop = await listenForProviderSecretChanges(pool, heard, quiet);

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(3));
    expect(refusing.released).toEqual([expect.any(Error)]);
    // Listening again: a change may have been missed meanwhile.
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    listening.notify();
    expect(heard).toHaveBeenCalledTimes(2);
    await stop();
  });

  it("keeps trying after a dropped connection, even when the first reconnects fail", async () => {
    const first = new FakeClient();
    const last = new FakeClient();
    const { pool, connect } = fakePool([first, new Error("down"), new Error("still down"), last]);
    const heard = vi.fn();
    const stop = await listenForProviderSecretChanges(pool, heard, quiet);

    first.emit("error", new Error("connection terminated"));

    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(4));
    expect(first.released).toEqual([expect.any(Error)]);
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    last.notify();
    expect(heard).toHaveBeenCalledTimes(2);
    await stop();
  });

  it("stops trying once stopped", async () => {
    const { pool, connect } = fakePool([new Error("down"), new Error("down"), new Error("down"), new Error("down")]);

    const stop = await listenForProviderSecretChanges(pool, vi.fn(), quiet);
    await stop();
    const tries = connect.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(connect.mock.calls.length).toBe(tries);
  });
});
