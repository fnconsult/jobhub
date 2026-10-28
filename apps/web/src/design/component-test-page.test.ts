import { describe, expect, it } from "vitest";
import { componentTestPageServed, densityOfTestPage } from "./component-test-page";

describe("the components' test page (#462)", () => {
  it("is served to the e2e suite and on a developer's machine", () => {
    expect(componentTestPageServed({ JOBHUB_TARGET: "e2e" })).toBe(true);
    expect(componentTestPageServed({ JOBHUB_TARGET: "development" })).toBe(true);
    expect(componentTestPageServed({ NODE_ENV: "development" })).toBe(true);
  });

  it("is never served in production or on staging, nor by a production build that names no target", () => {
    expect(componentTestPageServed({ JOBHUB_TARGET: "production" })).toBe(false);
    expect(componentTestPageServed({ JOBHUB_TARGET: "staging" })).toBe(false);
    expect(componentTestPageServed({ NODE_ENV: "production" })).toBe(false);
  });

  it("shows Confort unless the address asks for Compact", () => {
    expect(densityOfTestPage(undefined)).toBe("confort");
    expect(densityOfTestPage("compact")).toBe("compact");
    expect(densityOfTestPage("serré")).toBe("confort");
    expect(densityOfTestPage(["compact", "confort"])).toBe("compact");
  });
});
