/**
 * Kaspr (https://www.kaspr.io/api): enriches one known profile, by its LinkedIn
 * profile id, with work emails and phones. Kaspr documents no search by company
 * and job title, so `findPeople` is null: alone, it cannot find anyone.
 * Personal emails are never kept. Endpoint, auth and answer shape are
 * UNCONFIRMED (docs/research/issue-23.md): check them against Kaspr's API
 * reference before going live.
 */
import { requestJson, texts, type ContactDetails, type ContactEnrichmentProvider, type Fetch } from "./types";

const BASE_URL = "https://api.developers.kaspr.io";

interface KasprProfile {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  professionalEmails?: unknown[];
  phones?: unknown[];
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export function createKasprProvider({ apiKey, fetch: fetchFn = fetch, baseUrl = BASE_URL }: { apiKey: string; fetch?: Fetch; baseUrl?: string }): ContactEnrichmentProvider {
  return {
    id: "kaspr",
    findPeople: null,

    async getContactDetails({ providerPersonId }) {
      const answer = (await requestJson("kaspr", fetchFn, `${baseUrl}/profile/linkedin`, {
        headers: { authorization: `Bearer ${apiKey}`, "accept-version": "v2.0" },
        body: { id: providerPersonId },
      })) as { profile?: KasprProfile | null } | null;
      const profile = answer?.profile;
      const name = text(profile?.name);
      if (!profile || !name) return null;
      const details: ContactDetails = {
        providerPersonId,
        name,
        emails: texts(profile.professionalEmails ?? []),
        phones: texts(profile.phones ?? []),
      };
      const jobTitle = text(profile.title);
      if (jobTitle) details.jobTitle = jobTitle;
      return details;
    },
  };
}
