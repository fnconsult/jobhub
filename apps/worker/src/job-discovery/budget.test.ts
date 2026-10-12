import { describe, expect, it } from "vitest";
import { jobDiscoveryBudgetFromEnv } from "./index";

describe("the Job discovery budget from the environment", () => {
  it("defaults to 30 Job Offers, €0.08 and 90 s", () => {
    expect(jobDiscoveryBudgetFromEnv({})).toEqual({ jobOffers: 30, spendEur: 0.08, seconds: 90 });
    expect(jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_JOB_OFFERS: "", JOB_DISCOVERY_BUDGET_EUR: " ", JOB_DISCOVERY_BUDGET_SECONDS: "" })).toEqual({
      jobOffers: 30,
      spendEur: 0.08,
      seconds: 90,
    });
  });

  it("reads each limit", () => {
    expect(jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_JOB_OFFERS: "50", JOB_DISCOVERY_BUDGET_EUR: "0.15", JOB_DISCOVERY_BUDGET_SECONDS: "120" })).toEqual({
      jobOffers: 50,
      spendEur: 0.15,
      seconds: 120,
    });
  });

  it("refuses a limit that is not a positive number", () => {
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_JOB_OFFERS: "0" })).toThrow(/JOB_DISCOVERY_BUDGET_JOB_OFFERS/);
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_JOB_OFFERS: "2.5" })).toThrow(/JOB_DISCOVERY_BUDGET_JOB_OFFERS/);
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_EUR: "-0.01" })).toThrow(/JOB_DISCOVERY_BUDGET_EUR/);
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_EUR: "huit centimes" })).toThrow(/JOB_DISCOVERY_BUDGET_EUR/);
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_SECONDS: "0" })).toThrow(/JOB_DISCOVERY_BUDGET_SECONDS/);
  });

  it("keeps the run well inside the 15-minute Job Search timeout, which stays the safety net", () => {
    expect(jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_SECONDS: "600" })).toMatchObject({ seconds: 600 });
    expect(() => jobDiscoveryBudgetFromEnv({ JOB_DISCOVERY_BUDGET_SECONDS: "900" })).toThrow(/JOB_DISCOVERY_BUDGET_SECONDS/);
  });
});
