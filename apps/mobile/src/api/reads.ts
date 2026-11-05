/**
 * The Candidate's reads the app's screens use (`@jobhub/shared/reads`, #684): each a GET of the web app's `/api/*`
 * through `useApi()`, so it carries the API Version and the session, parsed with the read's own schema, and cached
 * under its `readKey` in the read cache (#701), which keeps on the device only what READS lists. A read answered 401
 * has the session checked (SessionGate), so a session ended on the web app signs the app out.
 */
import {
  applicationResponseSchema,
  profileResponseSchema,
  profilesResponseSchema,
  tailoredDocumentsResponseSchema,
  type ApplicationResponse,
  type ProfileResponse,
  type ProfilesResponse,
  type TailoredDocumentsResponse,
} from "@jobhub/shared/reads";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect } from "react";
import { readKey, type ReadName } from "../offline/read-cache";
import { useSession } from "../session/SessionGate";
import { useApi } from "./api";

/** The web app answered a read with an error: `status` 404 for what is not the Candidate's (or does not exist). */
export class ReadFailed extends Error {
  constructor(readonly status: number) {
    super(`read answered ${status}`);
    this.name = "ReadFailed";
  }
}

/**
 * A read is tried again once by itself when the network failed on the way (fetch's TypeError) or the web app failed
 * (5xx); never when it refused it (4xx), when the app is outdated (426), nor when the answer is not the read's shape.
 */
const tryAgain = (failures: number, error: Error) => failures < 1 && (error instanceof ReadFailed ? error.status >= 500 : error instanceof TypeError);

export type Read<T> = UseQueryResult<T, Error>;

/** A read's schema, from `@jobhub/shared/reads`: what parses the web app's answer. */
type Schema<T> = { parse: (answer: unknown) => T };

function useRead<T>(name: ReadName, path: string, schema: Schema<T>, params: string[], enabled = true): Read<T> {
  const api = useApi();
  const { checkSession } = useSession();
  const read = useQuery({
    queryKey: readKey(name, ...params),
    queryFn: async ({ signal }) => {
      const response = await api(path, { signal });
      if (!response.ok) throw new ReadFailed(response.status);
      return schema.parse(await response.json());
    },
    retry: tryAgain,
    enabled,
  });
  // Answered 401, the session ended on the web app (revoked, expired): checking it takes the app back to sign-in,
  // which forgets every read (SessionGate).
  const unauthorized = read.error instanceof ReadFailed && read.error.status === 401;
  useEffect(() => {
    if (unauthorized) checkSession();
  }, [unauthorized, checkSession]);
  return read;
}

const segment = encodeURIComponent;

/** `GET /api/profiles`: the Candidate's active Profiles, oldest first (Mon compte). */
export const useProfiles = (): Read<ProfilesResponse> => useRead("profiles", "/api/profiles", profilesResponseSchema, []);

/** `GET /api/profiles/:id`: one of the Candidate's Profiles to read; not read while `id` is null. */
export const useProfile = (id: string | null): Read<ProfileResponse> => useRead("profile", `/api/profiles/${segment(id ?? "")}`, profileResponseSchema, [id ?? ""], id !== null);

/** `GET /api/applications/:id`: one of the Candidate's Applications, its Job Offer named. */
export const useApplication = (id: string): Read<ApplicationResponse> => useRead("application", `/api/applications/${segment(id)}`, applicationResponseSchema, [id]);

/** `GET /api/applications/:id/documents`: an Application's Tailored Documents, with where to download them. */
export const useTailoredDocuments = (applicationId: string): Read<TailoredDocumentsResponse> =>
  useRead("tailoredDocuments", `/api/applications/${segment(applicationId)}/documents`, tailoredDocumentsResponseSchema, [applicationId]);
