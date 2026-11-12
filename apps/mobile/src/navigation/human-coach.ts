import { coachSpaceResponseSchema, type CoachSpaceResponse } from "@jobhub/shared/reads";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { useApi } from "../api/api";
import { read } from "../api/reads";

/** Asked again at most every five minutes: a Human Coach added or retired in the Back Office shows in the drawer soon after. */
const FRESH_FOR_MS = 5 * 60 * 1000;

/** `GET /api/coach-space`, read once for the drawer and « Espace coach v2 ». Never kept on the device (not in the Read cache). */
function useCoachSpace(): { data: CoachSpaceResponse | undefined; isPending: boolean } {
  const api = useApi();
  const { data, isPending } = useQuery({ queryKey: ["coachSpace"], queryFn: () => read(api, "/api/coach-space", coachSpaceResponseSchema), staleTime: FRESH_FOR_MS, retry: false });
  return { data, isPending };
}

/**
 * Whether the signed-in person is an active Human Coach (ADR-0016, `GET /api/coach-space`), for « Espace coach » in the
 * drawer (#689). Not known yet, unreachable or offline: not one, and never kept on the device (not in the Read cache).
 */
export function useIsHumanCoach(): boolean {
  return useCoachSpace().data?.humanCoach ?? false;
}

/** Association membership exposes its private WebView entry, never a Human Coach's Candidate permissions. */
export function useIsAssociationMember(): boolean {
  return useCoachSpace().data?.associationSpace ?? false;
}

/**
 * « Espace coach v2 » (ADR-0106) as the server says it, with `GET /api/coach-space`: true when on; false when off, absent
 * (a server from before it), unreachable or offline; undefined while not known yet.
 */
export function useCoachSpaceV2Read(): boolean | undefined {
  const { data, isPending } = useCoachSpace();
  if (data) return data.coachSpaceV2 === true;
  return isPending ? undefined : false;
}

/** The flag for the pages and panes below the shell; undefined while not known yet. Off by default (main's app). */
export const CoachSpaceV2Context = createContext<boolean | undefined>(false);

/** Whether the app shows the Human Coach epic (« Espace coach v2 » on); off, it behaves as before it. */
export function useCoachSpaceV2(): boolean {
  return useContext(CoachSpaceV2Context) === true;
}

/** The same, undefined while the server has not said yet: a page only the epic has waits rather than show « not found ». */
export function useCoachSpaceV2Known(): boolean | undefined {
  return useContext(CoachSpaceV2Context);
}
