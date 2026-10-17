import { describe, expect, it, vi } from "vitest";
import { APPLE_CLIENT_SECRETS, createJobs, type JobsDeps } from "./jobs";

const unused = async () => {
  throw new Error("unexpected call");
};

/** The jobs with only what Apple's client secret job uses. */
function jobsWith(signInProviders: NonNullable<JobsDeps["signInProviders"]>, alertAppleFailure: NonNullable<JobsDeps["alertAppleFailure"]>, log = vi.fn()) {
  return createJobs({
    database: { query: unused },
    discovery: { unavailable: "not used" },
    profiles: { get: unused },
    jobSearches: { record: unused, expireTimedOut: unused } as unknown as JobsDeps["jobSearches"],
    followUps: { proposeDue: unused },
    jobDigests: { claimDue: unused, deliver: unused },
    enqueue: unused,
    signInProviders,
    alertAppleFailure,
    log,
  });
}

describe("signing Apple's client secret again", () => {
  it("runs daily, signing it where a month has passed", async () => {
    const regenerate = vi.fn(async () => ({ regenerated: ["apple"], failed: [] }));
    const alert = vi.fn(async () => {});
    const log = vi.fn();
    const job = jobsWith({ regenerateAppleClientSecrets: regenerate }, alert, log)[APPLE_CLIENT_SECRETS]!;

    expect(job.cron).toBe("30 4 * * *");
    await job.handler({});

    expect(regenerate).toHaveBeenCalledOnce();
    expect(alert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("apple"));
  });

  it("alerts the super-admins when it starts failing, once per failure streak, not every day", async () => {
    const firstDay = { id: "apple", reason: "invalid_apple_key" as const, firstFailure: true };
    const nextDay = { ...firstDay, firstFailure: false };
    const alert = vi.fn(async () => {});
    const regenerate = vi.fn().mockResolvedValueOnce({ regenerated: [], failed: [firstDay] }).mockResolvedValueOnce({ regenerated: [], failed: [nextDay] });
    const log = vi.fn();
    const job = jobsWith({ regenerateAppleClientSecrets: regenerate }, alert, log)[APPLE_CLIENT_SECRETS]!;

    await job.handler({});
    await job.handler({});

    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith([firstDay]);
    // Still said in the log every day.
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("does nothing before the web app's migrations have created the table", async () => {
    const alert = vi.fn(async () => {});
    const job = jobsWith(
      {
        regenerateAppleClientSecrets: async () => {
          throw Object.assign(new Error('relation "sign_in_provider" does not exist'), { code: "42P01" });
        },
      },
      alert,
    )[APPLE_CLIENT_SECRETS]!;

    await expect(job.handler({})).resolves.toBeUndefined();
    expect(alert).not.toHaveBeenCalled();
  });
});
