/**
 * Lusha (https://docs.lusha.com, API v3): Prospecting finds people by job title
 * at a company (each result costs credits, so the page is kept small), then
 * Enrich Contacts reveals one person's emails and phones.
 * Do-not-contact people are left out of searches (`excludeDnc`).
 * The Enrich Contacts schema is UNCONFIRMED (docs/research/issue-23.md): check it
 * against the live API before going live.
 */
import { requestJson, texts, type ContactDetails, type ContactEnrichmentProvider, type Fetch, type FoundPerson } from "./types";

const BASE_URL = "https://api.lusha.com/v3";
/** Lusha pages hold 10 to 100 results. */
const PAGE_SIZE = { min: 10, max: 100 };
/** Prospecting caps the contacts it returns per company at 1 to 20. */
const MAX_CONTACTS_PER_COMPANY = 20;

interface LushaPerson {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  /** v3: `{ title, departments, seniority }`. */
  jobTitle?: { title?: unknown } | null;
  /** Set when Lusha could not give this result (e.g. COMPLIANCE_RESTRICTED). */
  error?: unknown;
  emailAddresses?: { email?: unknown }[];
  phoneNumbers?: { number?: unknown }[];
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined);
const nameOf = (person: LushaPerson) => texts([person.firstName, person.lastName]).join(" ") || text(person.fullName) || "";
const jobTitleOf = (person: LushaPerson) => (person.jobTitle && typeof person.jobTitle === "object" ? text(person.jobTitle.title) : undefined);

export function createLushaProvider({ apiKey, fetch: fetchFn = fetch, baseUrl = BASE_URL }: { apiKey: string; fetch?: Fetch; baseUrl?: string }): ContactEnrichmentProvider {
  const headers = { api_key: apiKey };
  return {
    id: "lusha",

    async findPeople({ companyName, companyDomain, jobTitles, limit }) {
      const answer = (await requestJson("lusha", fetchFn, `${baseUrl}/contacts/prospecting`, {
        headers,
        body: {
          pagination: { page: 0, size: Math.min(PAGE_SIZE.max, Math.max(PAGE_SIZE.min, limit)) },
          filters: {
            contacts: { include: { jobTitles } },
            companies: { include: companyDomain ? { domains: [companyDomain] } : { names: [companyName] } },
          },
          options: { excludeDnc: true, maxContactsPerCompany: Math.min(MAX_CONTACTS_PER_COMPANY, Math.max(1, limit)) },
        },
      })) as { results?: LushaPerson[] } | null;
      const people: FoundPerson[] = [];
      for (const person of answer?.results ?? []) {
        if (person.error) continue;
        const id = text(person.id);
        const name = nameOf(person);
        if (!id || !name) continue;
        const found: FoundPerson = { providerPersonId: id, name };
        const jobTitle = jobTitleOf(person);
        if (jobTitle) found.jobTitle = jobTitle;
        people.push(found);
      }
      return people.slice(0, limit);
    },

    async getContactDetails({ providerPersonId }) {
      const answer = (await requestJson("lusha", fetchFn, `${baseUrl}/contacts/enrich`, { headers, body: { contactIds: [providerPersonId] } })) as {
        contacts?: (LushaPerson & { isSuccess?: boolean; data?: LushaPerson })[];
      } | null;
      const contact = answer?.contacts?.find((entry) => text(entry.id) === providerPersonId) ?? answer?.contacts?.[0];
      if (!contact || contact.isSuccess === false) return null;
      const person = { ...contact, ...contact.data };
      const details: ContactDetails = {
        providerPersonId,
        name: nameOf(person),
        emails: texts((person.emailAddresses ?? []).map((entry) => entry.email)),
        phones: texts((person.phoneNumbers ?? []).map((entry) => entry.number)),
      };
      if (!details.name) return null;
      const jobTitle = text(person.jobTitle);
      if (jobTitle) details.jobTitle = jobTitle;
      return details;
    },
  };
}
