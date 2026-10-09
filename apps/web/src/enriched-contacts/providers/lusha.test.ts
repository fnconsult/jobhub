import { describe, expect, it } from "vitest";
import { createLushaProvider } from "./lusha";
import { recordedFetch } from "./recorded-fetch";

/** Shaped like the v3 example at https://docs.lusha.com/api-reference/prospecting/prospecting-contacts (names made up). */
const PROSPECTING_ANSWER = {
  results: [
    {
      id: "lusha-101",
      firstName: "Claire",
      lastName: "Martin",
      jobTitle: { title: "DRH", departments: ["Human Resources"], seniority: "Director" },
      company: { id: "c-1", name: "Acme Industrie", domain: "acme-industrie.fr" },
      has: ["emails", "phones"],
      canReveal: [{ field: "emails", credits: 1 }, { field: "phones", credits: 5 }],
    },
    { id: "lusha-104", firstName: "Lea", lastName: "Roux", jobTitle: { title: "DRH" }, error: { code: "COMPLIANCE_RESTRICTED", message: "Restricted" } },
    { firstName: "Paul", lastName: "Durand", jobTitle: { title: "DRH" } },
    {
      id: "lusha-102",
      firstName: "Hugo",
      lastName: "Bernard",
      jobTitle: { title: "Responsable recrutement", departments: ["Human Resources"], seniority: "Manager" },
      company: { id: "c-1", name: "Acme Industrie", domain: "acme-industrie.fr" },
    },
    { id: "lusha-103", firstName: "Inès", lastName: "Petit", jobTitle: { title: "HR Business Partner" } },
  ],
  pagination: { page: 0, size: 10, total: 4, totalGuaranteed: true },
  billing: { creditsCharged: 3, resultsReturned: 3 },
};

/** Shaped like the v3 example at https://docs.lusha.com/api-reference/enrich/enrich-contacts (names made up). */
const ENRICH_ANSWER = {
  results: [
    {
      id: "lusha-101",
      firstName: "Claire",
      lastName: "Martin",
      fullName: "Claire Martin",
      jobTitle: { title: "DRH", departments: ["Human Resources"], seniority: "Director" },
      location: { country: "France", isEuContact: true },
      company: { id: "c-1", name: "Acme Industrie", domain: "acme-industrie.fr" },
      emails: [{ email: "c.martin@acme-industrie.fr", type: "work", confidence: "A", updateDate: "2026-09-01" }],
      phones: [
        { number: "+33 4 72 00 00 00", type: "direct", doNotCall: false, updateDate: "2026-09-01" },
        { number: "+33 6 00 00 00 00", type: "mobile", doNotCall: true, updateDate: "2026-09-01" },
      ],
    },
  ],
  billing: { creditsCharged: 2, resultsReturned: 1 },
};

describe("Lusha adapter", () => {
  it("prospects people by job title at the company's domain, skipping results Lusha could not give", async () => {
    const api = recordedFetch({ body: PROSPECTING_ANSWER });
    const lusha = createLushaProvider({ apiKey: "lusha-test-key", fetch: api.fetch });

    const people = await lusha.findPeople!({ companyName: "Acme Industrie", companyDomain: "acme-industrie.fr", jobTitles: ["DRH", "Responsable recrutement"], limit: 2 });

    expect(people).toEqual([
      { providerPersonId: "lusha-101", name: "Claire Martin", jobTitle: "DRH" },
      { providerPersonId: "lusha-102", name: "Hugo Bernard", jobTitle: "Responsable recrutement" },
    ]);
    const [request] = api.requests;
    expect(request!.url).toBe("https://api.lusha.com/v3/contacts/prospecting");
    expect(request!.headers.api_key).toBe("lusha-test-key");
    expect(request!.body).toMatchObject({
      pagination: { page: 0, size: 10 },
      filters: {
        contacts: { include: { jobTitles: ["DRH", "Responsable recrutement"] } },
        companies: { include: { domains: ["acme-industrie.fr"] } },
      },
    });
  });

  it("leaves out do-not-contact people the way the v3 Prospecting schema accepts it", async () => {
    const api = recordedFetch({ body: { results: [] } });
    const lusha = createLushaProvider({ apiKey: "k", fetch: api.fetch });

    await lusha.findPeople!({ companyName: "Acme Industrie", jobTitles: ["DRH"], limit: 10 });

    const body = api.requests[0]!.body as { options?: { excludeDnc?: unknown; maxContactsPerCompany?: unknown }; excludeDnc?: unknown };
    expect(body.options?.excludeDnc).toBe(true);
    expect(body).not.toHaveProperty("excludeDnc");
    expect(body.options?.maxContactsPerCompany).toBe(10);
  });

  it("searches by company name when the domain is unknown", async () => {
    const api = recordedFetch({ body: { results: [] } });
    const lusha = createLushaProvider({ apiKey: "k", fetch: api.fetch });

    await lusha.findPeople!({ companyName: "Acme Industrie", jobTitles: ["DRH"], limit: 5 });
    expect(api.requests[0]!.body).toMatchObject({ filters: { companies: { include: { names: ["Acme Industrie"] } } } });
  });

  it("reveals a found person's emails and phones by their Lusha id, leaving out do-not-call numbers", async () => {
    const api = recordedFetch({ body: ENRICH_ANSWER });
    const lusha = createLushaProvider({ apiKey: "lusha-test-key", fetch: api.fetch });

    expect(await lusha.getContactDetails({ providerPersonId: "lusha-101" })).toEqual({
      providerPersonId: "lusha-101",
      name: "Claire Martin",
      jobTitle: "DRH",
      emails: ["c.martin@acme-industrie.fr"],
      phones: ["+33 4 72 00 00 00"],
    });
    expect(api.requests[0]!.url).toBe("https://api.lusha.com/v3/contacts/enrich");
    expect(api.requests[0]!.body).toEqual({ ids: ["lusha-101"], reveal: ["emails", "phones"] });
  });

  it("gives null when Lusha could not enrich the person", async () => {
    const lusha = createLushaProvider({ apiKey: "k", fetch: recordedFetch({ body: { results: [{ id: "lusha-9", error: { code: "NOT_FOUND", message: "Not found" } }] } }).fetch });
    expect(await lusha.getContactDetails({ providerPersonId: "lusha-9" })).toBeNull();
  });

  it("reports missing credits as a provider error", async () => {
    const lusha = createLushaProvider({ apiKey: "k", fetch: recordedFetch({ status: 402, body: { message: "Insufficient credits" } }).fetch });
    await expect(lusha.getContactDetails({ providerPersonId: "lusha-101" })).rejects.toMatchObject({ provider: "lusha", reason: "out_of_credits" });
  });
});
