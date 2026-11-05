import { useQuery } from "@tanstack/react-query";
import { readKey, type ReadName } from "../offline/read-cache";
import { useApi } from "./api";

/** A GET the web app answered with something other than a success: `status` says what (401 signed out, 5xx down). */
export class ReadFailed extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
  ) {
    super(`GET ${path} answered ${status}`);
    this.name = "ReadFailed";
  }
}

/** A refusal (4xx) is answered the same way again: only a network failure or the web app's own error is tried once more. */
const tryAgain = (failures: number, error: Error) =>
  failures < 1 && !(error instanceof ReadFailed && error.status < 500);

/**
 * A GET of the web app's API (`@jobhub/shared/reads`, ADR-0076) through the read cache under `name` (READS says whether
 * the device keeps it for when there is no network), its body parsed by `schema`, the type the route answers.
 */
export function useRead<T>(
  name: ReadName,
  path: string,
  schema: { parse: (body: unknown) => T },
  params: readonly string[] = [],
) {
  const api = useApi();
  return useQuery({
    queryKey: readKey(name, ...params),
    queryFn: async () => {
      const response = await api.fetch(path);
      if (!response.ok) throw new ReadFailed(path, response.status);
      return schema.parse(await response.json());
    },
    retry: tryAgain,
  });
}
