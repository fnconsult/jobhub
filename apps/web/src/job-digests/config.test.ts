import { describe, expect, it } from "vitest";
import { jobDigestsConfigFromEnv } from "./index";

describe("the Job Digest's Match Score threshold and target count", () => {
  it("default to 60 and 10", () => {
    expect(jobDigestsConfigFromEnv({})).toEqual({ minMatchScore: 60, targetCount: 10 });
    expect(jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "", JOB_DIGEST_TARGET_COUNT: " " })).toEqual({ minMatchScore: 60, targetCount: 10 });
  });

  it("are configurable by env", () => {
    expect(jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "75", JOB_DIGEST_TARGET_COUNT: "5" })).toEqual({ minMatchScore: 75, targetCount: 5 });
  });

  it("refuse a value that makes no sense, naming the variable", () => {
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "120" })).toThrow(/JOB_DIGEST_MIN_MATCH_SCORE/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_TARGET_COUNT: "0" })).toThrow(/JOB_DIGEST_TARGET_COUNT/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_TARGET_COUNT: "ten" })).toThrow(/JOB_DIGEST_TARGET_COUNT/);
  });
});
