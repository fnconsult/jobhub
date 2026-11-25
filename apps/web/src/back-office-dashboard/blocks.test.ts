import { describe, expect, it } from "vitest";
import { backOfficeAccess, BACK_OFFICE_ROLES } from "../admin/access";
import { dashboardBlocks } from "./blocks";

describe("the Back Office Dashboard's blocks", () => {
  it("shows the Job discovery consumption and budget to the roles that read Consommation IA: super-admins, Technique and Support", () => {
    const shown = BACK_OFFICE_ROLES.filter((role) => dashboardBlocks(backOfficeAccess([role])).includes("jobDiscovery"));

    expect(shown).toEqual(["super-admin", "platform-manager", "support"]);
  });

  it("shows the Extension card to the roles that read Activité › Extension: super-admins, Technique and Support (#925)", () => {
    const shown = BACK_OFFICE_ROLES.filter((role) => dashboardBlocks(backOfficeAccess([role])).includes("extension"));

    expect(shown).toEqual(["super-admin", "platform-manager", "support"]);
    expect(dashboardBlocks(backOfficeAccess(["super-admin"]))).toEqual(["api", "jobDiscovery", "extension"]);
  });

  it("shows the « API » block, each Tool's quota state, to every Back Office Role, first (#1116)", () => {
    for (const role of BACK_OFFICE_ROLES) expect(dashboardBlocks(backOfficeAccess([role]))[0], role).toBe("api");
  });

  it("shows a Plans manager the « API » block alone", () => {
    expect(dashboardBlocks(backOfficeAccess(["plans-manager"]))).toEqual(["api"]);
  });
});
