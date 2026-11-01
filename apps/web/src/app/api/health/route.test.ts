import { afterEach, describe, expect, it, vi } from "vitest";
import { builtVersion } from "@/release";
import { GET } from "./route";

const SHA = "3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f";

describe("/api/health (#559)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("answers ok with the Version, the commit and the environment it serves", async () => {
    vi.stubEnv("JOBHUB_TARGET", "staging");
    vi.stubEnv("JOBHUB_COMMIT", SHA);
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: builtVersion, commit: SHA, environment: "staging" });
  });

  it("names Production, and no commit when none is known", async () => {
    vi.stubEnv("JOBHUB_TARGET", "production");
    vi.stubEnv("JOBHUB_COMMIT", "");
    vi.stubEnv("JOBHUB_REVISION", "");
    expect(await GET().json()).toMatchObject({ status: "ok", commit: null, environment: "production" });
  });
});
