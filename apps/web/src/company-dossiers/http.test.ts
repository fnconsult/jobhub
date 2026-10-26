import { describe, expect, it } from "vitest";
import { STOPPED } from "../ndjson";
import { companyDossierOutcome } from "./http";

describe("a Company Dossier build, as its route answers", () => {
  it("answers the state built, the errors, not found or unavailable", () => {
    expect(companyDossierOutcome({ ok: true, state: { status: "employer_unknown" } })).toEqual({ status: 200, body: { status: "employer_unknown" } });
    expect(companyDossierOutcome({ ok: false, errors: [{ field: "employer", code: "not_a_company" }] })).toEqual({
      status: 400,
      body: { errors: [{ field: "employer", code: "not_a_company" }] },
    });
    expect(companyDossierOutcome({ ok: false, error: "not_found" })).toEqual({ status: 404, body: { error: "not_found" } });
    expect(companyDossierOutcome({ ok: false, error: "unavailable" })).toEqual({ status: 503, body: { error: "unavailable" } });
  });

  it("answers unavailable with its Failure Reason, for AI Activity to say why (#367)", () => {
    expect(companyDossierOutcome({ ok: false, error: "unavailable", reason: "provider_unavailable" })).toEqual({ status: 503, body: { error: "unavailable", reason: "provider_unavailable" } });
  });

  it("answers web search unavailable apart, its Failure Reason key_missing (#399)", () => {
    expect(companyDossierOutcome({ ok: false, error: "web_search_unavailable" })).toEqual({ status: 503, body: { error: "web_search_unavailable", reason: "key_missing" } });
  });

  it("answers a Stop with the dossier as now kept, its finished parts in it (#335)", () => {
    expect(companyDossierOutcome({ ok: false, error: "stopped", state: { status: "not_built" } })).toEqual({ status: STOPPED, body: { error: "stopped", state: { status: "not_built" } } });
  });
});
