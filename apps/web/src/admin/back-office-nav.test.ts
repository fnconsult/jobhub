import { describe, expect, it } from "vitest";
import { BACK_OFFICE_ROLES, backOfficeAccess } from "./access";
import { BACK_OFFICE_PAGES, backOfficeNav } from "./back-office-nav";

const sections = (nav: ReturnType<typeof backOfficeNav>) => nav.map((group) => [group.key, group.sections.map((section) => [section.key, section.href])]);

describe("the Back Office navigation", () => {
  it("shows a super-admin every section, grouped, Signalements first under Candidats then the Withdrawals (#511), Plans, their Quotas and Coupons under Offre, Paramètres (with the former Clés, Connexion and Sites de recherche, #396), AI consumption and Activité (#404) under Plateforme", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["super-admin"])))).toEqual([
      [
        "candidates",
        [
          ["signalements", "/admin/signalements"],
          ["withdrawals", "/admin/retractations"],
        ],
      ],
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
          ["coachingPlaybooks", "/admin/playbooks"],
          ["guardrails", "/admin/garde-fous"],
        ],
      ],
      ["content", [["unansweredQuestions", "/admin/questions-sans-reponse"]]],
      [
        "platform",
        [
          ["platformSettings", "/admin/parametres"],
          ["aiUsage", "/admin/consommation-ia"],
          ["activity", "/admin/activite"],
          ["tools", "/admin/outils"],
          ["designSystem", "/admin/design-system"],
        ],
      ],
      ["team", [["administrators", "/admin/administrateurs"]]],
    ]);
  });

  it("shows a Help editor the Signalements under Candidats (#376) and « Questions sans réponse » under Contenu (#344)", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["help-editor"])))).toEqual([
      ["candidates", [["signalements", "/admin/signalements"]]],
      ["content", [["unansweredQuestions", "/admin/questions-sans-reponse"]]],
      ["platform", [["designSystem", "/admin/design-system"]]],
    ]);
  });

  it("shows the « à traiter » count next to Signalements to those who change them, and to no one else (#376)", () => {
    const signalements = (nav: ReturnType<typeof backOfficeNav>) => nav.flatMap((group) => group.sections).find((section) => section.key === "signalements");

    expect(signalements(backOfficeNav(backOfficeAccess(["support"]), { signalements: 3 }))?.count).toBe(3);
    expect(signalements(backOfficeNav(backOfficeAccess(["super-admin"]), { signalements: 0 }))?.count).toBe(0);
    expect(signalements(backOfficeNav(backOfficeAccess(["help-editor"]), { signalements: 3 }))?.count).toBeUndefined();
    expect(signalements(backOfficeNav(backOfficeAccess(["support"])))?.count).toBeUndefined();
    expect(backOfficeNav(backOfficeAccess(["support"]), { signalements: 3 }).flatMap((group) => group.sections).filter((section) => section.count !== undefined)).toHaveLength(1);
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
      ["platform", [["designSystem", "/admin/design-system"]]],
    ]);
    expect(sections(backOfficeNav(backOfficeAccess(["coach-manager"])))).toEqual([
      [
        "coaching",
        [
          ["humanCoaches", "/admin/coachs"],
          ["coachCost", "/admin/cout-coach"],
        ],
      ],
      ["platform", [["designSystem", "/admin/design-system"]]],
    ]);
    // Support reads everything but Provider Secrets and the AI Message Log: the Unanswered Questions under Contenu, Paramètres (Connexion and the search sites among its tabs) and Consommation IA under Plateforme, read-only.
    expect(sections(backOfficeNav(backOfficeAccess(["support"]))).map(([key]) => key)).toEqual(["candidates", "offer", "coaching", "content", "platform"]);
    expect(sections(backOfficeNav(backOfficeAccess(["support"])))[4]).toEqual([
      "platform",
      [
        ["platformSettings", "/admin/parametres"],
        ["aiUsage", "/admin/consommation-ia"],
        ["activity", "/admin/activite"],
        ["tools", "/admin/outils"],
        ["designSystem", "/admin/design-system"],
      ],
    ]);
    // A Playbook editor sees the Coaching Playbooks, under Coaching (#225), and the Design System page.
    expect(sections(backOfficeNav(backOfficeAccess(["playbook-editor"])))).toEqual([
      ["coaching", [["coachingPlaybooks", "/admin/playbooks"]]],
      ["platform", [["designSystem", "/admin/design-system"]]],
    ]);
    expect(backOfficeNav(backOfficeAccess([]))).toEqual([]);
  });

  it("shows every Back Office Role the Design System page, last under Plateforme, and no one without a role (#463)", () => {
    for (const role of BACK_OFFICE_ROLES) {
      const platform = backOfficeNav(backOfficeAccess([role])).find((group) => group.key === "platform");
      expect(platform?.sections.at(-1), role).toEqual({ key: "designSystem", href: "/admin/design-system" });
    }
    expect(backOfficeNav(backOfficeAccess([]))).toEqual([]);
  });

  it("has no entry for Clés, Connexion nor Sites de recherche, now tabs of Paramètres (#396), whose pages stay their resources' pages", () => {
    const keys = backOfficeNav(backOfficeAccess(["super-admin"])).flatMap((group) => group.sections.map((section) => section.key));
    expect(keys).not.toEqual(expect.arrayContaining(["providerSecrets"]));
    expect(keys).not.toContain("signInProviders");
    expect(keys).not.toContain("searchSites");
    expect(BACK_OFFICE_PAGES.providerSecrets.href).toBe("/admin/parametres");
    expect(BACK_OFFICE_PAGES.signInProviders.href).toBe("/admin/parametres?tab=connexion");
    expect(BACK_OFFICE_PAGES.searchSites.href).toBe("/admin/parametres?tab=sources");
  });

  it("has one entry « Activité » whose tabs are Recherches, Appels IA and Actions des administrateurs, no longer their own sections (#404)", () => {
    const keys = backOfficeNav(backOfficeAccess(["super-admin"])).flatMap((group) => group.sections.map((section) => section.key));
    expect(keys).not.toContain("aiMessages");
    expect(keys).not.toContain("journal");
    expect(BACK_OFFICE_PAGES.discoveryRuns.href).toBe("/admin/activite/recherches");
    expect(BACK_OFFICE_PAGES.aiMessages.href).toBe("/admin/activite/appels-ia");
    expect(BACK_OFFICE_PAGES.journal.href).toBe("/admin/activite/actions");
    // Technique reads the Recherches and the Actions des administrateurs: Activité is in their sidebar.
    expect(backOfficeNav(backOfficeAccess(["platform-manager"])).flatMap((group) => group.sections.map((section) => section.key))).toContain("activity");
  });
});
