import { describe, expect, it } from "vitest";
import { tailoredCvOutcome } from "./http";

describe("a Tailored CV proposal, as its route answers", () => {
  it("answers unavailable with its Failure Reason, for AI Activity to say why (#367)", () => {
    expect(tailoredCvOutcome({ ok: false, error: "unavailable", reason: "rate_limited" })).toEqual({ status: 503, body: { error: "unavailable", reason: "rate_limited" } });
    expect(tailoredCvOutcome({ ok: false, error: "unavailable" })).toEqual({ status: 503, body: { error: "unavailable" } });
  });
});
