import { describe, expect, it } from "vitest";
import { createApolloProvider } from "./apollo";
import { recordedFetch } from "./recorded-fetch";
import { ContactProviderError } from "./types";

/** Shaped like https://docs.apollo.io/reference/people-api-search (names made up). */
const SEARCH_ANSWER = {
  total_entries: 2,
  people: [
    { id: "64a1f0c2e5b0a1", first_name: "Claire", last_name_obfuscated: "Ma***n", title: "Directrice des Ressources Humaines", has_email: true, organization: { name: "Acme Industrie" } },
    { id: "64a1f0c2e5b0a2", first_name: "Hugo", last_name_obfuscated: "Be***d", title: "Talent Acquisition Manager", has_email: false, organization: { name: "Acme Industrie" } },
  ],
};

/** Shaped like https://docs.apollo.io/reference/people-enrichment. */
const MATCH_ANSWER = {
  person: {
    id: "64a1f0c2e5b0a1",
    first_name: "Claire",
    last_name: "Martin",
    name: "Claire Martin",
    title: "Directrice des Ressources Humaines",
    email: "claire.martin@acme-industrie.fr",
    email_status: "verified",
    linkedin_url: "http://www.linkedin.com/in/claire-martin-example",
  },
};

describe("Apollo adapter", () => {
  it("finds people at the company's domain by job title, without spending credits on their details", async () => {
    const api = recordedFetch({ body: SEARCH_ANSWER });
    const apollo = createApolloProvider({ apiKey: "apollo-test-key", fetch: api.fetch });

    const people = await apollo.findPeople!({ companyName: "Acme Industrie", companyDomain: "acme-industrie.fr", jobTitles: ["DRH", "Talent Acquisition"], limit: 5 });

    expect(people).toEqual([
      { providerPersonId: "64a1f0c2e5b0a1", name: "Claire Ma***n", jobTitle: "Directrice des Ressources Humaines" },
      { providerPersonId: "64a1f0c2e5b0a2", name: "Hugo Be***d", jobTitle: "Talent Acquisition Manager" },
    ]);
    const [request] = api.requests;
    expect(request!.method).toBe("POST");
    const url = new URL(request!.url);
    expect(url.origin + url.pathname).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect(url.searchParams.getAll("person_titles[]")).toEqual(["DRH", "Talent Acquisition"]);
    expect(url.searchParams.getAll("q_organization_domains_list[]")).toEqual(["acme-industrie.fr"]);
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(request!.headers["x-api-key"]).toBe("apollo-test-key");
  });

  it("searches by company name when the domain is unknown", async () => {
    const api = recordedFetch({ body: { people: [] } });
    const apollo = createApolloProvider({ apiKey: "k", fetch: api.fetch });

    expect(await apollo.findPeople!({ companyName: "Acme Industrie", jobTitles: ["DRH"], limit: 5 })).toEqual([]);
    expect(new URL(api.requests[0]!.url).searchParams.get("q_organization_name")).toBe("Acme Industrie");
  });

  it("reveals a found person's email by their Apollo id (phones are not asked for)", async () => {
    const api = recordedFetch({ body: MATCH_ANSWER });
    const apollo = createApolloProvider({ apiKey: "apollo-test-key", fetch: api.fetch });

    expect(await apollo.getContactDetails({ providerPersonId: "64a1f0c2e5b0a1" })).toEqual({
      providerPersonId: "64a1f0c2e5b0a1",
      name: "Claire Martin",
      jobTitle: "Directrice des Ressources Humaines",
      emails: ["claire.martin@acme-industrie.fr"],
      phones: [],
    });
    const [request] = api.requests;
    expect(request!.url).toBe("https://api.apollo.io/api/v1/people/match");
    expect(request!.body).toEqual({ id: "64a1f0c2e5b0a1", reveal_personal_emails: false, reveal_phone_number: false });
  });

  it("gives null when Apollo has no such person", async () => {
    const apollo = createApolloProvider({ apiKey: "k", fetch: recordedFetch({ body: { person: null } }).fetch });
    expect(await apollo.getContactDetails({ providerPersonId: "nobody" })).toBeNull();
  });

  it("reports a refused key or exhausted rate limit as a provider error", async () => {
    const refused = createApolloProvider({ apiKey: "bad", fetch: recordedFetch({ status: 401, body: { error: "Invalid access credentials." } }).fetch });
    await expect(refused.getContactDetails({ providerPersonId: "x" })).rejects.toMatchObject({ provider: "apollo", reason: "unauthorized" });
    const limited = createApolloProvider({ apiKey: "k", fetch: recordedFetch({ status: 429, body: {} }).fetch });
    await expect(limited.findPeople!({ companyName: "Acme", jobTitles: ["DRH"], limit: 1 })).rejects.toBeInstanceOf(ContactProviderError);
  });
});
