import { describe, it, expect } from "vitest";
import { contractFixture, type ContractFixture } from "./fixture";
describe("synthetic legal fixture isolation", () => {
  const fixture: ContractFixture = { registry: [], written: { fr: [], en: [] } };
  const globals = { [Symbol.for("jobbbox.e2e.coach-contract")]: fixture };
  it("ignores preloaded fixtures in production, staging, and an unset target", () => {
    for (const target of ["production", "staging", undefined]) expect(contractFixture({ JOBHUB_TARGET: target }, globals)).toBeUndefined();
  });
  it("requires both an explicit E2E target and a deliberately loaded harness", () => {
    expect(contractFixture({ JOBHUB_TARGET: "e2e" }, {})).toBeUndefined();
    expect(contractFixture({ JOBHUB_TARGET: "e2e" }, globals)).toBe(fixture);
  });
});
