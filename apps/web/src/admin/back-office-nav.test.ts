import { describe, expect, it } from "vitest";
import { backOfficeAccess } from "./access";
import { backOfficeNav } from "./back-office-nav";

const sections = (nav: ReturnType<typeof backOfficeNav>) => nav.map((group) => [group.key, group.sections.map((section) => [section.key, section.href])]);

describe("the Back Office navigation", () => {
  it("shows a super-admin every section, grouped, Signalements first under Candidats, Plans, their Quotas and Coupons under Offre, Provider Secrets (Clés), Sign-in Providers (Connexion), AI consumption and AI message logs under Plateforme", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["super-admin"])))).toEqual([
      ["candidates", [["signalements", "/admin/signalements"]]],
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
          ["providerSecrets", "/admin/cles"],
          ["platformSettings", "/admin/parametres"],
          ["signInProviders", "/admin/connexion"],
          ["aiUsage", "/admin/consommation-ia"],
          ["aiMessages", "/admin/journaux-ia"],
          ["searchSites", "/admin/sites"],
          ["tools", "/admin/outils"],
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

  it("shows a Help editor the Signalements under Candidats (#376) and « Questions sans réponse » under Contenu (#344)", () => {
    expect(sections(backOfficeNav(backOfficeAccess(["help-editor"])))).toEqual([
      ["candidates", [["signalements", "/admin/signalements"]]],
      ["content", [["unansweredQuestions", "/admin/questions-sans-reponse"]]],
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
    // Support reads everything but Provider Secrets and the AI Message Log: the Unanswered Questions under Contenu, Connexion, Consommation IA and the search sites under Plateforme, read-only.
    expect(sections(backOfficeNav(backOfficeAccess(["support"]))).map(([key]) => key)).toEqual(["candidates", "offer", "coaching", "content", "platform"]);
    expect(sections(backOfficeNav(backOfficeAccess(["support"])))[4]).toEqual([
      "platform",
      [
        ["platformSettings", "/admin/parametres"],
        ["signInProviders", "/admin/connexion"],
        ["aiUsage", "/admin/consommation-ia"],
        ["searchSites", "/admin/sites"],
        ["tools", "/admin/outils"],
      ],
    ]);
    // A Playbook editor sees the Coaching Playbooks alone, under Coaching (#225).
    expect(sections(backOfficeNav(backOfficeAccess(["playbook-editor"])))).toEqual([["coaching", [["coachingPlaybooks", "/admin/playbooks"]]]]);
    expect(backOfficeNav(backOfficeAccess([]))).toEqual([]);
  });
});
