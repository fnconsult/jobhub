import { describe, expect, it } from "vitest";
import { backOfficeAccess } from "./access";
import { backOfficeNav } from "./back-office-nav";

const sections = (nav: ReturnType<typeof backOfficeNav>) => nav.map((group) => [group.key, group.sections.map((section) => [section.key, section.href])]);

describe("the Back Office navigation", () => {
  it("shows a super-admin every section, grouped, Plans, their Quotas and Coupons under Offre, Provider Secrets (Clés) and Sign-in Providers (Connexion) under Plateforme", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["super-admin"])))).toEqual([
      [
        "offer",
        [
          ["plans", "/admin/offres"],
          ["planQuotas", "/admin/quotas"],
          ["coupons", "/admin/codes-promo"],
        ],
      ],
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
          ["signInProviders", "/admin/connexion"],
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
    expect(sections(backOfficeNav(backOfficeAccess(["plans-manager"])))).toEqual([
      [
        "offer",
        [
          ["plans", "/admin/offres"],
          ["planQuotas", "/admin/quotas"],
          ["coupons", "/admin/codes-promo"],
        ],
      ],
    ]);
    expect(sections(backOfficeNav(backOfficeAccess(["coach-manager"])))).toEqual([
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
        ],
      ],
    ]);
    // Support reads everything but Provider Secrets: Connexion and the search sites under Plateforme, read-only.
    expect(sections(backOfficeNav(backOfficeAccess(["support"]))).map(([key]) => key)).toEqual(["offer", "coaching", "platform"]);
    expect(sections(backOfficeNav(backOfficeAccess(["support"])))[2]).toEqual(["platform", [["signInProviders", "/admin/connexion"], ["searchSites", "/admin/sites"]]]);
    expect(backOfficeNav(backOfficeAccess([]))).toEqual([]);
  });
});
