import { describe, expect, it } from "vitest";
import { nouveautesDeployment } from "./deployment";

describe("nouveautesDeployment — the Version this deployment serves, and whether it is the Beta", () => {
  it("on the Beta (staging), sets the Version it serves apart, not yet published", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "staging", JOBHUB_VERSION: "0.2.0" })).toEqual({ version: "0.2.0", beta: true });
  });

  it("in production, publishes it", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "production", JOBHUB_VERSION: "0.2.0" })).toEqual({ version: "0.2.0", beta: false });
  });

  it("a production build that names no target is taken for production, never for the Beta", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_VERSION: "0.2.0" }).beta).toBe(false);
  });

  it("the e2e suite and a developer's machine run what main carries: the Beta's next Version", () => {
    expect(nouveautesDeployment({ NODE_ENV: "production", JOBHUB_TARGET: "e2e", JOBHUB_VERSION: "0.2.0" }).beta).toBe(true);
    expect(nouveautesDeployment({ NODE_ENV: "development", JOBHUB_VERSION: "0.2.0" }).beta).toBe(true);
  });

  it("knows no Version when the build was given none", () => {
    expect(nouveautesDeployment({ JOBHUB_TARGET: "staging" }).version).toBeNull();
    expect(nouveautesDeployment({ JOBHUB_TARGET: "staging", JOBHUB_VERSION: " " }).version).toBeNull();
  });
});
