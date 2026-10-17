import { describe, expect, it } from "vitest";
import { backOfficeAccess } from "./access";
import { backOfficeNav } from "./back-office-nav";

const sections = (nav: ReturnType<typeof backOfficeNav>) => nav.map((group) => [group.key, group.sections.map((section) => [section.key, section.href])]);

describe("the Back Office navigation", () => {
  it("shows a super-admin every section, grouped, Provider Secrets (Clés) under Plateforme", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["super-admin"])))).toEqual([
      ["offer", [["planQuotas", "/admin/quotas"]]],
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
        ],
      ],
      [
        "platform",
        [
          ["providerSecrets", "/admin/cles"],
          ["searchSites", "/admin/sites"],
        ],
      ],
      [
        "team",
        [
          ["administrators", "/admin/administrateurs"],
          ["journal", "/admin/journal"],
        ],
      ],
    ]);
  });

  it("shows only the sections an Administrator's roles cover, and leaves out groups with none", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["plans-manager"])))).toEqual([["offer", [["planQuotas", "/admin/quotas"]]]]);
    expect(sections(backOfficeNav(backOfficeAccess(["coach-manager"])))).toEqual([
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
        ],
      ],
    ]);
    // Support reads everything but Provider Secrets: Plateforme holds only the search sites.
    expect(backOfficeNav(backOfficeAccess(["support"])).map((group) => group.key)).toEqual(["offer", "coaching", "platform"]);
    expect(backOfficeNav(backOfficeAccess(["support"])).find((group) => group.key === "platform")?.sections.map((section) => section.key)).toEqual(["searchSites"]);
    expect(backOfficeNav(backOfficeAccess([]))).toEqual([]);
  });
});
