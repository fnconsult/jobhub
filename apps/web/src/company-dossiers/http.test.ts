import { companyDossierResponseSchema } from "@jobhub/shared/reads";
import { describe, expect, it } from "vitest";
import { STOPPED } from "../ndjson";
import { companyDossierOutcome, companyDossierRead } from "./http";
import type { CompanyDossierState } from "./index";

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

/** A read as the app parses it, once it went over HTTP (JSON). */
const overHttp = (state: CompanyDossierState) => companyDossierResponseSchema.parse(JSON.parse(JSON.stringify(companyDossierRead(state))));

describe("a Company Dossier, as its GET answers the app (ADR-0076, #691)", () => {
  const builtAt = new Date("2026-11-02T09:00:00.000Z");
  const news = [{ title: "Acme ouvre un site à Lyon", outlet: "Le Progrès", publishedAt: "2026-10-12", url: "https://www.leprogres.fr/acme" }];

  it("answers a register dossier with its absent facts as null, its date as an instant, and no Provenance", () => {
    const read = overHttp({
      status: "built",
      dossier: {
        source: "french_register",
        reliability: "official",
        employer: "Acme Industrie",
        builtAt,
        siren: "552100554",
        name: "ACME INDUSTRIE",
        headcount: { min: 250 },
        financials: [{ year: 2025, revenue: 12_500_000 }],
        executiveRoles: ["Président de SAS"],
        suggestedContactRoles: ["hiring_manager", "hr_director"],
        news,
        newsSearched: true,
      },
      provenance: null,
    });
    expect(read).toEqual({
      status: "built",
      dossier: {
        source: "french_register",
        reliability: "official",
        employer: "Acme Industrie",
        builtAt: "2026-11-02T09:00:00.000Z",
        siren: "552100554",
        name: "ACME INDUSTRIE",
        legalForm: null,
        activity: null,
        address: null,
        headcount: { min: 250, max: null },
        financials: [{ year: 2025, revenue: 12_500_000, netIncome: null }],
        executiveRoles: ["Président de SAS"],
        suggestedContactRoles: ["hiring_manager", "hr_director"],
        news,
        newsSearched: true,
      },
    });
  });

  it("answers a web dossier with its sources, its absent facts as null", () => {
    const read = overHttp({
      status: "built",
      dossier: { source: "web", reliability: "less_reliable", employer: "Globex", builtAt, country: "Allemagne", sources: ["https://globex.de"], suggestedContactRoles: [], news: [], newsSearched: false },
    });
    expect(read).toMatchObject({ dossier: { source: "web", country: "Allemagne", address: null, industry: null, headcount: null, revenue: null, website: null, sources: ["https://globex.de"] } });
  });

  it("answers the states before a dossier is built, a Presumed Employer's absent parts as null", () => {
    expect(overHttp({ status: "not_built" })).toEqual({ status: "not_built" });
    expect(overHttp({ status: "employer_unknown" })).toEqual({ status: "employer_unknown" });
    expect(overHttp({ status: "awaiting_confirmation", presumedEmployer: "Acme", agency: "Hays" })).toEqual({
      status: "awaiting_confirmation",
      presumedEmployer: "Acme",
      presumedEmployerDescription: null,
      agency: "Hays",
    });
  });
});
