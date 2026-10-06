import { describe, expect, it } from "vitest";
import { createThrowawayDatabase } from "./throwaway-database";

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
