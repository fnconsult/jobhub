import { describe, expect, it } from "vitest";
import { addedTargetCompanyOutcome } from "./http";

describe("adding a Target Company by name, as its route answers (#409)", () => {
  it("answers the company added, else why the name is refused", () => {
    const company = { id: "t-1", name: "ACME INDUSTRIE" };
    expect(addedTargetCompanyOutcome({ ok: true, company } as never)).toEqual({ status: 201, body: { company } });
    expect(addedTargetCompanyOutcome({ ok: false, error: "exists" })).toEqual({ status: 400, body: { errors: [{ field: "name", code: "exists" }] } });
    expect(addedTargetCompanyOutcome({ ok: false, error: "not_a_company" })).toEqual({ status: 400, body: { errors: [{ field: "name", code: "not_a_company" }] } });
    expect(addedTargetCompanyOutcome({ ok: false, error: "invalid" })).toEqual({ status: 400, body: { errors: [{ field: "name", code: "invalid" }] } });
  });
});
