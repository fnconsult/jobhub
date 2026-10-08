import { describe, expect, it } from "vitest";
import { createThrowawayDatabase, dropLeftoverThrowawayDatabases } from "./throwaway-database";

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)("throwaway test database", () => {
  // Regression: dropping the database WITH (FORCE) right after Pool.end()
  // made Postgres terminate connections that were still closing (57P01); the
  // pool had already detached its error listeners, so `npm test` exited 1.
  it("is dropped without terminating connections that are still open", async () => {
    const unhandled: unknown[] = [];
    const record = (error: unknown) => void unhandled.push(error);
    process.on("uncaughtException", record);
    try {
      const database = await createThrowawayDatabase("test_throwaway");
      await Promise.all(Array.from({ length: 10 }, () => database.pool.query("SELECT pg_sleep(0.01)")));
      await database.drop();
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      process.off("uncaughtException", record);
    }
    expect(unhandled).toEqual([]);
  });

  it("is really gone once dropped", async () => {
    const database = await createThrowawayDatabase("test_throwaway");
    await database.drop();
    const { Pool } = await import("pg");
    const admin = new Pool({ connectionString });
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database.name]);
    await admin.end();
    expect(rows).toEqual([]);
  });
});

describe.skipIf(!connectionString)("throwaway test databases a test never dropped", () => {
  async function exists(name: string) {
    const { Pool } = await import("pg");
    const admin = new Pool({ connectionString });
    const { rows } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    await admin.end();
    return rows.length === 1;
  }

  // Regression: when a beforeEach timed out on a loaded Postgres, the
  // database it was still creating was never dropped (afterEach had nothing,
  // or the previous test's database, to drop), and 150+ of them piled up on
  // the server, slowing every later run down.
  it("are dropped once the test file is done, including one still being created", async () => {
    const forgotten = await createThrowawayDatabase("test_throwaway");
    const stillCreating = createThrowawayDatabase("test_throwaway");

    await dropLeftoverThrowawayDatabases();

    expect(await exists(forgotten.name)).toBe(false);
    expect(await exists((await stillCreating).name)).toBe(false);
  });

  it("can be dropped again without failing", async () => {
    const database = await createThrowawayDatabase("test_throwaway");
    await database.drop();
    await expect(database.drop()).resolves.toBeUndefined();
    await expect(dropLeftoverThrowawayDatabases()).resolves.toBeUndefined();
  });
});
