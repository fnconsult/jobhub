import { getBackOffice } from "@/admin/server";
import { sharedPool } from "@/database/pool";
import { createDiscoveryRuns, type DiscoveryRuns } from "./index";

let instance: DiscoveryRuns | undefined;

/** The Job discovery runs, as Activité › Recherches reads them; opening a run's Job Search goes to the Back Office Audit. */
export function getDiscoveryRuns(): DiscoveryRuns {
  instance ??= createDiscoveryRuns(sharedPool(), { backOffice: getBackOffice() });
  return instance;
}
