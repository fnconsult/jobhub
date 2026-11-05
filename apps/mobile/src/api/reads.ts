import { useQuery } from "@tanstack/react-query";
import { readKey, type ReadName } from "../offline/read-cache";
import { useApi } from "./api-context";

/**
 * A GET of the web app's API (`@jobhub/shared/reads`), read through the read cache under `name` (READS says whether the
 * device keeps it for when there is no network): its data once read, parsed by `schema`.
 */
export function useRead<T>(name: ReadName, path: string, schema: { parse: (body: unknown) => T }, params: readonly string[] = []) {
  const api = useApi();
  return useQuery({ queryKey: readKey(name, ...params), queryFn: () => api.read(path, schema) });
}
