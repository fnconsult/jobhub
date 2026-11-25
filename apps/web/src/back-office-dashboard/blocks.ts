import type { BackOfficeAccess, BackOfficeResource } from "../admin/access";

/**
 * The Back Office Dashboard's blocks, in order, each with the section whose readers see it (ADR-0042): an
 * Administrator who cannot read that section sees none of its figures. `api`: the « API » block (#1116), each Tool's
 * quota state, seen by every Administrator whatever their roles (`null`: no section); `jobDiscovery`: web search and
 * Job discovery consumption and budget, read with Consommation IA; `extension`: the Extension card (#925), what the
 * extension did and what failed over 30 days, read with Activité › Extension.
 */
const BLOCKS = { api: null, jobDiscovery: "aiUsage", extension: "extensionEvents" } as const satisfies Record<string, BackOfficeResource | null>;

export type DashboardBlock = keyof typeof BLOCKS;

/** The blocks `access` sees, in order: the « API » block, then those of the sections its roles read. */
export function dashboardBlocks(access: BackOfficeAccess): DashboardBlock[] {
  return (Object.keys(BLOCKS) as DashboardBlock[]).filter((block) => {
    const section = BLOCKS[block];
    return section === null || access.can(section, "read");
  });
}
