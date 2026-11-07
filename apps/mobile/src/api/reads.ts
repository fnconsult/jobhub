/**
 * The Candidate's reads the app's screens use (`@jobhub/shared/reads`, #684): each a GET of the web app's `/api/*`
 * through `useApi()`, so it carries the API Version and the session, parsed with the read's own schema, and cached
 * under its `readKey` in the read cache (#701), which keeps on the device only what READS lists. A read answered 401
 * has the session checked (SessionGate), so a session ended on the web app signs the app out.
 */
import {
  agendaResponseSchema,
  applicationResponseSchema,
  companyDossierResponseSchema,
  enrichedContactsResponseSchema,
  jobDigestResponseSchema,
  jobSearchResponseSchema,
  offerBoxOfferResponseSchema,
  offerBoxResponseSchema,
  profileResponseSchema,
  profilesResponseSchema,
  tailoredDocumentsResponseSchema,
  type AgendaResponse,
  type ApplicationResponse,
  type CompanyDossierResponse,
  type EnrichedContactsResponse,
  type JobDigestResponse,
  type JobSearchResponse,
  type OfferBoxOfferResponse,
  type OfferBoxResponse,
  type ProfileResponse,
  type ProfilesResponse,
  type TailoredDocumentsResponse,
} from "@jobhub/shared/reads";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";
import { readKey, type ReadName } from "../offline/read-cache";
import { useSession } from "../session/SessionGate";
import { useApi, type ApiFetch } from "./api";

/** The web app answered a read with an error: `status` 404 for what is not the Candidate's (or does not exist). */
export class ReadFailed extends Error {
  constructor(readonly status: number) {
    super(`read answered ${status}`);
    this.name = "ReadFailed";
  }
}

/**
 * Whether the network failed on the way: the global fetch rejects with a TypeError, the app's `expo/fetch` (`appFetch`)
 * with a FetchError, which it does not export and whose message starts « fetch failed: » (expo's FetchErrors.ts).
 */
const networkFailed = (error: Error) => error instanceof TypeError || error.message.startsWith("fetch failed:");

/**
 * A read is tried again once by itself when the network failed on the way or the web app failed (5xx); never when it
 * refused it (4xx), when the app is outdated (426), nor when the answer is not the read's shape.
 */
const tryAgain = (failures: number, error: Error) => failures < 1 && (error instanceof ReadFailed ? error.status >= 500 : networkFailed(error));

export type Read<T> = UseQueryResult<T, Error>;

/** A read's schema, from `@jobhub/shared/reads`: what parses the web app's answer. */
type Schema<T> = { parse: (answer: unknown) => T };

/**
 * A GET of `path` through `api`, its JSON body parsed by `schema`; ReadFailed on any other answer than a success. For a
 * read the device never keeps and that needs no session check (LegalSteps, the Espace coach entry, #689).
 */
export async function read<T>(api: ApiFetch, path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T> {
  const response = await api(path, { signal });
  if (!response.ok) throw new ReadFailed(response.status);
  return schema.parse(await response.json());
}

/**
 * A GET of `path` through the read cache under `name` (READS says whether the device keeps it for when there is no
 * network), parsed by `schema`; not read while `enabled` is false. A read answered 401 has the session checked. With
 * `readAgain`, read again after the number of ms it gives for what was last read (and when), until it gives false: a
 * page waiting for something to happen on the web app.
 */
export function useRead<T>(
  name: ReadName,
  path: string,
  schema: Schema<T>,
  params: readonly string[] = [],
  enabled = true,
  { readAgain }: { readAgain?: (data: T | undefined, readAt: number) => number | false } = {},
): Read<T> {
  const api = useApi();
  const { recheck } = useSession();
  const query = useQuery({
    queryKey: readKey(name, ...params),
    queryFn: ({ signal }) => read(api, path, schema, signal),
    retry: tryAgain,
    enabled,
    refetchInterval: readAgain ? (query) => readAgain(query.state.data, query.state.dataUpdatedAt) : false,
  });
  // Answered 401, the session ended on the web app (revoked, expired): checking it takes the app back to sign-in,
  // which forgets every read (SessionGate).
  const unauthorized = query.error instanceof ReadFailed && query.error.status === 401;
  useEffect(() => {
    if (unauthorized) void recheck();
  }, [unauthorized, recheck]);
  return query;
}

const segment = encodeURIComponent;

/** `GET /api/profiles`: the Candidate's active Profiles, oldest first (Mon compte). */
export const useProfiles = (): Read<ProfilesResponse> => useRead("profiles", "/api/profiles", profilesResponseSchema, []);

/** `GET /api/profiles/:id`: one of the Candidate's Profiles to read; not read while `id` is null. */
export const useProfile = (id: string | null): Read<ProfileResponse> => useRead("profile", `/api/profiles/${segment(id ?? "")}`, profileResponseSchema, [id ?? ""], id !== null);

/** `GET /api/agenda`: the Candidate's Agenda, « À planifier » then the upcoming days (#693); kept on the device (READS). */
export const useAgenda = (): Read<AgendaResponse> => useRead("agenda", "/api/agenda", agendaResponseSchema, []);

/** `GET /api/applications/:id`: one of the Candidate's Applications, its Job Offer named, with its Interviews; not read while `id` is null. */
export const useApplication = (id: string | null): Read<ApplicationResponse> =>
  useRead("application", `/api/applications/${segment(id ?? "")}`, applicationResponseSchema, [id ?? ""], id !== null);

/** `GET /api/applications/:id/documents`: an Application's Tailored Documents, with where to download them. */
export const useTailoredDocuments = (applicationId: string): Read<TailoredDocumentsResponse> =>
  useRead("tailoredDocuments", `/api/applications/${segment(applicationId)}/documents`, tailoredDocumentsResponseSchema, [applicationId]);

/** `GET /api/offer-box`: the Offer box (« Offres à traiter », ADR-0090), Recherches d'offres' screen; kept on the device (READS). */
export const useOfferBox = (): Read<OfferBoxResponse> => useRead("offerBox", "/api/offer-box", offerBoxResponseSchema, []);

/**
 * `GET /api/offer-box/:id`: one Offer box entry's Job Offer as its Work Pane shows it (#692), its text and why its Match
 * Score, against the Profile « Suivre » saves it with; kept on the device (READS), as a Job Search's Job Offers.
 */
export const useOfferBoxOffer = (entryId: string): Read<OfferBoxOfferResponse> =>
  useRead("offerBoxOffer", `/api/offer-box/${segment(entryId)}`, offerBoxOfferResponseSchema, [entryId]);

/** How often a Job Search's page reads it again while it searches: the web's page refreshes itself as often. */
const WHILE_SEARCHING_MS = 5000;

/**
 * `GET /api/job-searches/:id`: one of the Candidate's Job Searches and its Job Offers, best Match Score first, read again
 * while it searches; kept on the device (READS), so its Job Offers open offline.
 */
export const useJobSearch = (id: string): Read<JobSearchResponse> =>
  useRead("jobSearch", `/api/job-searches/${segment(id)}`, jobSearchResponseSchema, [id], true, {
    readAgain: (search) => (search?.status === "searching" ? WHILE_SEARCHING_MS : false),
  });

/** `GET /api/job-digests/:id`: one of the Candidate's Job Digests sent and its Job Offers, best Match Score first; kept on the device (READS). */
export const useJobDigest = (id: string): Read<JobDigestResponse> => useRead("jobDigest", `/api/job-digests/${segment(id)}`, jobDigestResponseSchema, [id]);

/** `GET /api/applications/:id/company-dossier`: an Application's Company Dossier as the web app last built it; kept on the device (READS). */
export const useCompanyDossier = (applicationId: string): Read<CompanyDossierResponse> =>
  useRead("companyDossier", `/api/applications/${segment(applicationId)}/company-dossier`, companyDossierResponseSchema, [applicationId]);

/**
 * `GET /api/applications/:id/enriched-contacts`: the people found at an Application's employer and its Enriched
 * Contacts; never kept on the device (READS), a third party's personal data.
 */
export const useEnrichedContacts = (applicationId: string): Read<EnrichedContactsResponse> =>
  useRead("enrichedContacts", `/api/applications/${segment(applicationId)}/enriched-contacts`, enrichedContactsResponseSchema, [applicationId]);
