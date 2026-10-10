/**
 * The contact-enrichment interface every licensed data provider is reached
 * through (#23): find people at a company by job title, then get one person's
 * contact details. Adapters (Lusha, Kaspr, Apollo) map it to their APIs; nothing
 * outside them knows a provider's endpoints or payloads.
 */

/** The data providers an adapter exists for. */
export const CONTACT_PROVIDERS = ["lusha", "kaspr", "apollo"] as const;
export type ContactProviderId = (typeof CONTACT_PROVIDERS)[number];

/** Who to look for: people holding one of `jobTitles` at the company. */
export interface PeopleSearch {
  companyName: string;
  /** The company's web domain (acme.fr), when known: providers match on it more reliably than on a name. */
  companyDomain?: string;
  /** Job titles to look for, in the words the provider's data uses (e.g. "DRH", "HR Director"). */
  jobTitles: string[];
  /** At most this many people. */
  limit: number;
}

/** A person a search found: who and where, no contact details yet (revealing those costs provider credits). */
export interface FoundPerson {
  /** The provider's own id for the person, to get their details and to answer a data-subject request. */
  providerPersonId: string;
  /** As the provider gives it before reveal: the last name may be shortened or hidden (Apollo). */
  name: string;
  jobTitle?: string;
}

/** What the provider knows of a person once revealed. */
export interface ContactDetails {
  providerPersonId: string;
  name: string;
  jobTitle?: string;
  emails: string[];
  phones: string[];
}

export interface ContactEnrichmentProvider {
  readonly id: ContactProviderId;
  /** People at the company holding one of the job titles; null when the provider offers no such search (Kaspr). */
  readonly findPeople: ((search: PeopleSearch) => Promise<FoundPerson[]>) | null;
  /** A found person's contact details, or null when the provider has none. Spends provider credits. */
  getContactDetails(person: { providerPersonId: string }): Promise<ContactDetails | null>;
}

/** Why a provider could not answer. Nothing was found or revealed; the Candidate may try again later. */
export class ContactProviderError extends Error {
  constructor(
    readonly provider: ContactProviderId,
    readonly reason: "unauthorized" | "out_of_credits" | "rate_limited" | "failed",
    message: string = reason,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ContactProviderError";
  }
}

/** How adapters reach the provider: the global `fetch` in the app, a recorded one in tests. */
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

/** Sends one JSON request to a provider; its JSON answer, or a ContactProviderError. A 404 is "nothing found": null. */
export async function requestJson(
  provider: ContactProviderId,
  fetchFn: Fetch,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: init.method ?? "POST",
      headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    if (error instanceof ContactProviderError) throw error;
    throw new ContactProviderError(provider, "failed", error instanceof Error ? error.message : String(error));
  }
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) throw new ContactProviderError(provider, "unauthorized", `HTTP ${response.status}`);
  if (response.status === 402) throw new ContactProviderError(provider, "out_of_credits", "HTTP 402");
  if (response.status === 429) throw new ContactProviderError(provider, "rate_limited", "HTTP 429");
  if (!response.ok) throw new ContactProviderError(provider, "failed", `HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ContactProviderError(provider, "failed", "the answer is not JSON");
  }
}

/** Strings only, trimmed, non-empty, without duplicates. */
export function texts(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
}
