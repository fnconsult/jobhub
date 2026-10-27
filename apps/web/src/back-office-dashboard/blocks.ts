import type { BackOfficeAccess, BackOfficeResource } from "../admin/access";

/**
 * The Back Office Dashboard's blocks, in order, each with the section whose readers see it (ADR-0042): an
 * Administrator who cannot read that section sees none of its figures. `jobDiscovery`: web search and Job
 * discovery consumption and budget, read with Consommation IA.
 */
const BLOCKS = { jobDiscovery: "aiUsage" } as const satisfies Record<string, BackOfficeResource>;

export type DashboardBlock = keyof typeof BLOCKS;

/** The blocks `access` sees, in order; none for roles that read none of their sections. */
export function dashboardBlocks(access: BackOfficeAccess): DashboardBlock[] {
  return (Object.keys(BLOCKS) as DashboardBlock[]).filter((block) => access.can(BLOCKS[block], "read"));
}
