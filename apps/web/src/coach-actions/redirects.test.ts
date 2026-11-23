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
      "account_delete",
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

  it("need no one's data to be built: on no objects, the page lists them", async () => {
    expect(await createRedirects(null).to("profile_create", { candidateId: "eval", language: "fr" })).toEqual({ page: "Créer un profil", section: null, object: "Nouveau profil", href: "/profils/nouveau" });
    expect(await createRedirects(null).to("profile_rename", { candidateId: "eval", language: "fr", profileId: "p1" })).toMatchObject({ href: "/compte/profils" });
  });
});
