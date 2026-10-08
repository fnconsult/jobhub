/**
 * Apollo (https://docs.apollo.io): People API Search finds people by title and
 * company domain without spending credits and without contact details; People
 * Enrichment reveals one person's email (credits). Phones are revealed
 * asynchronously by Apollo (webhook), so they are not asked for.
 * Apollo withholds personal emails of people in GDPR regions: work emails only.
 */
import { requestJson, texts, type ContactDetails, type ContactEnrichmentProvider, type Fetch, type FoundPerson } from "./types";

const BASE_URL = "https://api.apollo.io/api/v1";

interface ApolloPerson {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  last_name_obfuscated?: unknown;
  name?: unknown;
  title?: unknown;
  email?: unknown;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function nameOf(person: ApolloPerson): string {
  return text(person.name) ?? texts([person.first_name, person.last_name ?? person.last_name_obfuscated]).join(" ");
}

export function createApolloProvider({ apiKey, fetch: fetchFn = fetch, baseUrl = BASE_URL }: { apiKey: string; fetch?: Fetch; baseUrl?: string }): ContactEnrichmentProvider {
  const headers = { "x-api-key": apiKey, "cache-control": "no-cache" };
  return {
    id: "apollo",

    async findPeople({ companyName, companyDomain, jobTitles, limit }) {
      const url = new URL(`${baseUrl}/mixed_people/api_search`);
      for (const title of jobTitles) url.searchParams.append("person_titles[]", title);
      if (companyDomain) url.searchParams.append("q_organization_domains_list[]", companyDomain);
      else url.searchParams.set("q_organization_name", companyName);
      url.searchParams.set("page", "1");
      url.searchParams.set("per_page", String(limit));
      const answer = (await requestJson("apollo", fetchFn, url.toString(), { headers })) as { people?: ApolloPerson[] } | null;
      const people: FoundPerson[] = [];
      for (const person of answer?.people ?? []) {
        const id = text(person.id);
        const name = nameOf(person);
        if (!id || !name) continue;
        const found: FoundPerson = { providerPersonId: id, name };
        const jobTitle = text(person.title);
        if (jobTitle) found.jobTitle = jobTitle;
        people.push(found);
      }
      return people.slice(0, limit);
    },

    async getContactDetails({ providerPersonId }) {
      const answer = (await requestJson("apollo", fetchFn, `${baseUrl}/people/match`, {
        headers,
        body: { id: providerPersonId, reveal_personal_emails: false, reveal_phone_number: false },
      })) as { person?: ApolloPerson | null } | null;
      const person = answer?.person;
      if (!person) return null;
      const details: ContactDetails = { providerPersonId: text(person.id) ?? providerPersonId, name: nameOf(person), emails: texts([person.email]), phones: [] };
      const jobTitle = text(person.title);
      if (jobTitle) details.jobTitle = jobTitle;
      return details;
    },
  };
}
