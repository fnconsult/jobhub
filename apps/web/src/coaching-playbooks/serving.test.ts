import { describe, expect, it } from "vitest";
import { playbookServing } from "./serving";

describe("which Playbook Versions an environment serves (ADR-0019, ADR-0021)", () => {
  it("production serves only the latest Human-validated version", () => {
    expect(playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: "production" })).toBe("validated");
  });

  it("staging, e2e and development serve the latest version, validated or not", () => {
    expect(playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: "staging" })).toBe("latest");
    expect(playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: "e2e" })).toBe("latest");
    expect(playbookServing({ NODE_ENV: "development" })).toBe("latest");
    expect(playbookServing({ NODE_ENV: "test" })).toBe("latest");
    expect(playbookServing({})).toBe("latest");
  });

  it("a production build that does not say where it runs is taken for production", () => {
    expect(playbookServing({ NODE_ENV: "production" })).toBe("validated");
    expect(playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: " " })).toBe("validated");
  });

  it("refuses an unknown target rather than guess", () => {
    expect(() => playbookServing({ NODE_ENV: "production", JOBHUB_TARGET: "prod" })).toThrow(/JOBHUB_TARGET/);
  });
});
