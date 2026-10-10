import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedPool } from "./pool";

const url = "postgres://localhost/pool-test";

describe("the web app's shared Postgres pool", () => {
  afterEach(async () => {
    const pool = sharedPool({ DATABASE_URL: url });
    if (!pool.ending) await pool.end();
  });

  it("is one pool per database for the whole process, so modules never add connections of their own", () => {
    expect(sharedPool({ DATABASE_URL: url })).toBe(sharedPool({ DATABASE_URL: url }));
  });

  it("survives a second copy of the module (Next.js bundles server code more than once)", async () => {
    const first = sharedPool({ DATABASE_URL: url });
    vi.resetModules();
    const copy = await import("./pool");
    expect(copy.sharedPool({ DATABASE_URL: url })).toBe(first);
  });

  it("is bounded: 10 connections unless DATABASE_POOL_MAX says otherwise", async () => {
    expect(sharedPool({ DATABASE_URL: url }).options.max).toBe(10);
    await sharedPool({ DATABASE_URL: url }).end();
    expect(sharedPool({ DATABASE_URL: url, DATABASE_POOL_MAX: "4" }).options.max).toBe(4);
  });

  it("starts afresh once a pool was ended", async () => {
    const ended = sharedPool({ DATABASE_URL: url });
    await ended.end();
    expect(sharedPool({ DATABASE_URL: url })).not.toBe(ended);
  });

  it("needs DATABASE_URL", () => {
    expect(() => sharedPool({})).toThrow(/DATABASE_URL/);
  });
});
