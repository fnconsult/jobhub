import { describe, expect, it } from "vitest";
import { backOfficeAccess, BACK_OFFICE_ROLES } from "../admin/access";
import { dashboardBlocks } from "./blocks";

describe("the Back Office Dashboard's blocks", () => {
  it("shows the Job discovery consumption and budget to the roles that read Consommation IA: super-admins, Technique and Support", () => {
    const shown = BACK_OFFICE_ROLES.filter((role) => dashboardBlocks(backOfficeAccess([role])).includes("jobDiscovery"));

    expect(shown).toEqual(["super-admin", "platform-manager", "support"]);
  });

  it("shows a Plans manager none of them", () => {
    expect(dashboardBlocks(backOfficeAccess(["plans-manager"]))).toEqual([]);
  });
});
