import { describe, expect, it } from "vitest";
import { tailoredDocumentsOutcome } from "./http";

describe("a Tailored Document drafted, as its route answers", () => {
  it("answers unavailable with its Failure Reason, for AI Activity to say why (#367)", () => {
    expect(tailoredDocumentsOutcome({ ok: false, error: "unavailable", reason: "provider_unavailable" })).toEqual({ status: 503, body: { error: "unavailable", reason: "provider_unavailable" } });
    expect(tailoredDocumentsOutcome({ ok: false, error: "unavailable" })).toEqual({ status: 503, body: { error: "unavailable" } });
  });
});
