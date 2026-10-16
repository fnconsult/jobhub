import { describe, expect, it } from "vitest";
import { backOfficeAccess } from "./access";
import { backOfficeNav } from "./back-office-nav";

const sections = (nav: ReturnType<typeof backOfficeNav>) => nav.map((group) => [group.key, group.sections.map((section) => [section.key, section.href])]);

describe("the Back Office navigation", () => {
  it("shows a super-admin every section, grouped, and no empty group", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["super-admin"]), "/admin"))).toEqual([
      ["offer", [["planQuotas", "/admin/quotas"]]],
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
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
    expect(sections(backOfficeNav(backOfficeAccess(["plans-manager"]), "/admin"))).toEqual([["offer", [["planQuotas", "/admin/quotas"]]]]);
    expect(sections(backOfficeNav(backOfficeAccess(["coach-manager"]), "/admin"))).toEqual([
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
        ],
      ],
    ]);
    expect(backOfficeNav(backOfficeAccess(["support"]), "/admin").map((group) => group.key)).toEqual(["offer", "coaching"]);
    expect(backOfficeNav(backOfficeAccess([]), "/admin")).toEqual([]);
  });

  it("marks the section shown, pages under it included", () => {
    const nav = backOfficeNav(backOfficeAccess(["super-admin"]), "/admin/journal");
    const current = nav.flatMap((group) => group.sections).filter((section) => section.current);
    expect(current.map((section) => section.key)).toEqual(["journal"]);
  });
});
