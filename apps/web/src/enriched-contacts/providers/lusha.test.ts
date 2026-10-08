import { describe, expect, it } from "vitest";
import { createLushaProvider } from "./lusha";
import { recordedFetch } from "./recorded-fetch";

/** Shaped like https://docs.lusha.com/api-reference/prospecting/prospecting-contacts (names made up). */
const PROSPECTING_ANSWER = {
  requestId: "req-1",
  data: [
    { id: "lusha-101", firstName: "Claire", lastName: "Martin", jobTitle: "DRH", company: { name: "Acme Industrie" }, canReveal: { email: 1 } },
    { id: "lusha-102", firstName: "Hugo", lastName: "Bernard", jobTitle: "Responsable recrutement", company: { name: "Acme Industrie" } },
    { id: "lusha-103", firstName: "Inès", lastName: "Petit", jobTitle: "HR Business Partner", company: { name: "Acme Industrie" } },
  ],
  billing: { creditsCharged: 3 },
};

/** The Enrich Contacts answer (schema UNCONFIRMED, see docs/research/issue-23.md): details under `data`. */
const ENRICH_ANSWER = {
  contacts: [
    {
      id: "lusha-101",
      isSuccess: true,
      data: {
        firstName: "Claire",
        lastName: "Martin",
        jobTitle: "DRH",
        emailAddresses: [{ email: "c.martin@acme-industrie.fr", emailType: "work" }],
        phoneNumbers: [{ number: "+33 4 72 00 00 00", phoneType: "direct" }],
      },
    },
  ],
};

describe("Lusha adapter", () => {
  it("prospects people by job title at the company's domain, leaving out do-not-contact people", async () => {
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
      excludeDnc: true,
    });
  });

  it("searches by company name when the domain is unknown", async () => {
    const api = recordedFetch({ body: { data: [] } });
    const lusha = createLushaProvider({ apiKey: "k", fetch: api.fetch });

    await lusha.findPeople!({ companyName: "Acme Industrie", jobTitles: ["DRH"], limit: 5 });
    expect(api.requests[0]!.body).toMatchObject({ filters: { companies: { include: { names: ["Acme Industrie"] } } } });
  });

  it("reveals a found person's emails and phones by their Lusha id", async () => {
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
    expect(api.requests[0]!.body).toEqual({ contactIds: ["lusha-101"] });
  });

  it("gives null when Lusha could not enrich the person", async () => {
    const lusha = createLushaProvider({ apiKey: "k", fetch: recordedFetch({ body: { contacts: [{ id: "lusha-9", isSuccess: false }] } }).fetch });
    expect(await lusha.getContactDetails({ providerPersonId: "lusha-9" })).toBeNull();
  });

  it("reports missing credits as a provider error", async () => {
    const lusha = createLushaProvider({ apiKey: "k", fetch: recordedFetch({ status: 402, body: { message: "Insufficient credits" } }).fetch });
    await expect(lusha.getContactDetails({ providerPersonId: "lusha-101" })).rejects.toMatchObject({ provider: "lusha", reason: "out_of_credits" });
  });
});
