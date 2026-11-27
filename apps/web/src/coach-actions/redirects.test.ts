import { describe, expect, it } from "vitest";
import { createRedirects, REDIRECT_OF_ACTION, REDIRECT_TARGETS, redirectLine, redirectTableText, type RedirectSources } from "./redirects";

// Typed redirects (ADR-0114): the server builds where the Candidate does it themselves, the AI model only names the row.

const FINANCE = { id: "p-finance", name: "Finance", archived: false };
const ACHATS = { id: "p-achats", name: "Achats", archived: false };
const OLD = { id: "p-old", name: "Ancien", archived: true };
const BENCHLING = { id: "a-benchling", profile: { id: "p-finance" }, jobOffer: { title: "Data Analyst", employer: "Benchling" } };

const sources = (profiles = [FINANCE, ACHATS, OLD]): RedirectSources =>
  ({
    profiles: {
      get: async (candidateId: string, id: string) => (candidateId === "marie" ? (profiles.find((each) => each.id === id) ?? null) : null),
      list: async (candidateId: string) => (candidateId === "marie" ? profiles : []),
    },
    applications: { get: async (candidateId: string, id: string) => (candidateId === "marie" && id === BENCHLING.id ? BENCHLING : null) },
  }) as unknown as RedirectSources;

describe("typed redirects (ADR-0114)", () => {
  it("name a page, its Section and the object, with the link the server builds", async () => {
    const redirects = createRedirects(sources());
    const redirect = await redirects.to("master_cv_section", { candidateId: "marie", language: "fr", profileId: "p-finance", section: "languages" });
    expect(redirect).toEqual({ page: "Profil Finance", section: "CV de référence", object: "Langues", href: "/profils/p-finance/cv" });
    expect(redirectLine(redirect!)).toBe("Profil Finance › CV de référence › Langues");
  });

  it("take the Profile In view, or the Profile of the Application In view, when none is named", async () => {
    const redirects = createRedirects(sources());
    expect(await redirects.to("profile_rename", { candidateId: "marie", language: "fr", inView: { kind: "profile", id: "p-achats" } })).toMatchObject({
      page: "Profil Achats",
      href: "/profils/p-achats",
    });
    expect(await redirects.to("master_cv_version_restore", { candidateId: "marie", language: "fr", inView: { kind: "application", id: "a-benchling" } })).toEqual({
      page: "Profil Finance",
      section: "CV de référence",
      object: "Versions du CV de référence",
      href: "/profils/p-finance/versions",
    });
  });

  it("send to the list of Profiles when none can be told, and never to another Candidate's or an Archived Profile", async () => {
    const redirects = createRedirects(sources());
    const listed = { page: "Mes profils", section: null, href: "/compte/profils" };
    expect(await redirects.to("profile_duplicate", { candidateId: "marie", language: "fr" })).toMatchObject(listed);
    expect(await redirects.to("profile_duplicate", { candidateId: "marie", language: "fr", profileId: "p-old" })).toMatchObject(listed);
    expect(await redirects.to("profile_duplicate", { candidateId: "paul", language: "fr", profileId: "p-finance" })).toMatchObject(listed);
    // Their only active Profile needs no naming.
    expect(await createRedirects(sources([FINANCE])).to("profile_duplicate", { candidateId: "marie", language: "fr" })).toMatchObject({
      page: "Profil Finance",
      section: "Gérer",
      href: "/profils/p-finance/gerer",
    });
  });

  it("send an Application's rows to its Section: « offre plus publiée » to L'offre, an Interview's deletion to Entretiens", async () => {
    const redirects = createRedirects(sources());
    expect(await redirects.to("job_offer_unpublished", { candidateId: "marie", language: "fr", inView: { kind: "application", id: "a-benchling" } })).toEqual({
      page: "Candidature Data Analyst · Benchling",
      section: "L'offre",
      object: "Signaler que l'offre n'est plus publiée",
      href: "/candidatures/a-benchling/offre",
    });
    expect(await redirects.to("interview_delete", { candidateId: "marie", language: "en", applicationId: "a-benchling" })).toMatchObject({
      section: "Interviews",
      href: "/candidatures/a-benchling/entretiens",
    });
    expect(await redirects.to("interview_delete", { candidateId: "paul", language: "fr", applicationId: "a-benchling" })).toMatchObject({ href: "/candidatures" });
  });

  it("send a contact search the Plan does not include to « Abonnement », one without a provider to the company's dossier (ADR-0119, #1157)", async () => {
    const redirects = createRedirects(sources());
    expect(await redirects.to("plan", { candidateId: "marie", language: "fr" })).toEqual({ page: "Abonnement", section: null, object: "Changer d'offre", href: "/abonnement" });
    expect(await redirects.to("plan", { candidateId: "marie", language: "en" })).toEqual({ page: "Subscription", section: null, object: "Change plan", href: "/abonnement" });
    // A Target Company's Spontaneous Application: its Dossier Section.
    expect(await redirects.to("company_dossier", { candidateId: "marie", language: "fr", applicationId: "a-benchling", profileId: "p-finance" })).toEqual({
      page: "Candidature Data Analyst · Benchling",
      section: "Dossier entreprise",
      object: "Dossier entreprise",
      href: "/candidatures/a-benchling/dossier",
    });
    // None yet: its Profile's Entreprises cibles, never another Candidate's.
    expect(await redirects.to("company_dossier", { candidateId: "marie", language: "fr", profileId: "p-achats" })).toEqual({
      page: "Profil Achats",
      section: "Entreprises cibles",
      object: "Dossier entreprise",
      href: "/profils/p-achats/entreprises-cibles",
    });
    expect(await redirects.to("company_dossier", { candidateId: "paul", language: "fr", profileId: "p-achats" })).toMatchObject({ href: "/candidatures" });
    expect(redirectTableText()).toMatch(/- plan : changer d'offre.*tu ne changes jamais d'offre/);
  });

  it("cover every object with no Coach Action, each named in both languages, and nothing else", async () => {
    expect(REDIRECT_TARGETS).toEqual([
      "profile_rename",
      "profile_duplicate",
      "profile_create",
      "profile_delete",
      "master_cv_version_restore",
      "master_cv_section",
      "search_criteria",
      "job_offer_unpublished",
      "interview_delete",
      "company_dossier",
      "coach_memory",
      "coach_conversation_delete",
      "account_delete",
      "plan",
    ]);
    const redirects = createRedirects(sources());
    for (const target of REDIRECT_TARGETS) {
      for (const language of ["fr", "en"] as const) {
        const redirect = await redirects.to(target, { candidateId: "marie", language, profileId: "p-finance", applicationId: "a-benchling" });
        expect(redirect?.href, target).toMatch(/^\//);
        expect(redirect?.object, target).not.toMatch(/coachRedirects/);
        expect(redirect?.page, target).not.toMatch(/coachRedirects/);
      }
    }
    expect(await redirects.to("rename_everything", { candidateId: "marie", language: "fr" })).toBeNull();
    expect(redirectTableText().split("\n")).toHaveLength(REDIRECT_TARGETS.length);
    expect(Object.values(REDIRECT_OF_ACTION).every((target) => REDIRECT_TARGETS.includes(target))).toBe(true);
  });

  it("cover each deletion the Candidate makes themselves: an item of the Coach Memory, a Coach Conversation, under « Coach » in the menu", async () => {
    const redirects = createRedirects(sources());
    expect(await redirects.to("coach_memory", { candidateId: "marie", language: "fr", inView: { kind: "profile", id: "p-finance" } })).toEqual({
      page: "Coach",
      section: null,
      object: "Mémoire du coach",
      href: "/?memoire",
    });
    expect(await redirects.to("coach_conversation_delete", { candidateId: "marie", language: "en" })).toEqual({ page: "Coach", section: null, object: "Delete the conversation", href: "/" });
    expect(redirectTableText()).toMatch(/- coach_memory : .*supprimer/);
    expect(redirectTableText()).toMatch(/- coach_conversation_delete : supprimer une conversation/);
  });

  it("send each Coach Action a reply may be refused to the row where the Candidate does it themselves, a memory to remember included", () => {
    expect(REDIRECT_OF_ACTION).toMatchObject({ propose_master_cv_changes: "master_cv_section", propose_search_criteria: "search_criteria", propose_coach_memory: "coach_memory" });
  });

  it("need no one's data to be built: on no objects, the page lists them", async () => {
    expect(await createRedirects(null).to("profile_create", { candidateId: "eval", language: "fr" })).toEqual({ page: "Créer un profil", section: null, object: "Nouveau profil", href: "/profils/nouveau" });
    expect(await createRedirects(null).to("profile_rename", { candidateId: "eval", language: "fr", profileId: "p1" })).toMatchObject({ href: "/compte/profils" });
  });
});
