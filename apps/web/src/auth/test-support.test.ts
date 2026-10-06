import { describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth } from "./test-support";

describe.skipIf(!connectionString)("throwaway auth database", () => {
  // Regression: stop() dropped the database WITH (FORCE) while pooled
  // connections were still closing, so Postgres killed them (57P01) and the
  // listener-less clients raised unhandled errors that made `npm test` exit 1.
  it("is torn down without terminating connections that are still open", async () => {
    const unhandled: unknown[] = [];
    const record = (error: unknown) => void unhandled.push(error);
    process.on("uncaughtException", record);
    try {
      const testAuth = await startTestAuth();
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => signInWithMagicLink(testAuth, `teardown-${i}@example.com`)),
      );
      await testAuth.stop();
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      process.off("uncaughtException", record);
    }
    expect(unhandled).toEqual([]);
  });
});
