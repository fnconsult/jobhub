import { coachSpaceResponseSchema } from "@jobhub/shared/reads";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "../api/api-context";

/** Asked again at most every five minutes: a Human Coach added or retired in the Back Office shows in the drawer soon after. */
const FRESH_FOR_MS = 5 * 60 * 1000;

/**
 * Whether the signed-in person is an active Human Coach (ADR-0016, `GET /api/coach-space`), for « Espace coach » in the
 * drawer (#689). Not known yet, unreachable or offline: not one, and never kept on the device (not in the Read cache).
 */
export function useIsHumanCoach(): boolean {
  const api = useApi();
  const { data } = useQuery({ queryKey: ["coachSpace"], queryFn: () => api.read("/api/coach-space", coachSpaceResponseSchema), staleTime: FRESH_FOR_MS, retry: false });
  return data?.humanCoach ?? false;
}
