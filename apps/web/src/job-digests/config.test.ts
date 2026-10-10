import { describe, expect, it } from "vitest";
import { jobDigestsConfigFromEnv } from "./index";

describe("the Job Digest's Match Score threshold, target count and first look-back", () => {
  it("default to 60, 10 and a week", () => {
    expect(jobDigestsConfigFromEnv({})).toEqual({ minMatchScore: 60, targetCount: 10, firstLookBackDays: 7 });
    expect(jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "", JOB_DIGEST_TARGET_COUNT: " ", JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "" })).toEqual({
      minMatchScore: 60,
      targetCount: 10,
      firstLookBackDays: 7,
    });
  });

  it("are configurable by env", () => {
    expect(jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "75", JOB_DIGEST_TARGET_COUNT: "5", JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "3" })).toEqual({
      minMatchScore: 75,
      targetCount: 5,
      firstLookBackDays: 3,
    });
    // None: the first Job Digest of a Profile is what Job discovery finds.
    expect(jobDigestsConfigFromEnv({ JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "0" })).toMatchObject({ firstLookBackDays: 0 });
  });

  it("refuse a value that makes no sense, naming the variable", () => {
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_MIN_MATCH_SCORE: "120" })).toThrow(/JOB_DIGEST_MIN_MATCH_SCORE/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_TARGET_COUNT: "0" })).toThrow(/JOB_DIGEST_TARGET_COUNT/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_TARGET_COUNT: "ten" })).toThrow(/JOB_DIGEST_TARGET_COUNT/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "-1" })).toThrow(/JOB_DIGEST_FIRST_LOOK_BACK_DAYS/);
    expect(() => jobDigestsConfigFromEnv({ JOB_DIGEST_FIRST_LOOK_BACK_DAYS: "1.5" })).toThrow(/JOB_DIGEST_FIRST_LOOK_BACK_DAYS/);
  });
});
