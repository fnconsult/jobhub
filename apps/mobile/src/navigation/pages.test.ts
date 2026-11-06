import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { applicationIdOf, pageFor, profileIdOf } from "./pages";

const t = createI18n(DEFAULT_LOCALE).t;

describe("a Profile's page (#695)", () => {
  it("is titled with the Profile's name, as its read gives it", () => {
    expect(pageFor("/profils/prof_lyon", t, { profile: { id: "prof_lyon", name: "Supply chain à Lyon" } })).toEqual({ key: "/profils/prof_lyon", title: "Supply chain à Lyon", pane: "fiche" });
  });

  it("is titled « Profil » while its read has not answered", () => {
    expect(pageFor("/profils/prof_lyon", t).title).toBe("Profil");
  });

  it("never takes the name of another Profile read before", () => {
    expect(pageFor("/profils/prof_achats", t, { profile: { id: "prof_lyon", name: "Supply chain à Lyon" } }).title).toBe("Profil");
  });

  it("names the Profile to read from its address, and none on any other page", () => {
    expect(profileIdOf("/profils/prof%20lyon")).toBe("prof lyon");
    expect(profileIdOf("/compte")).toBeNull();
    expect(profileIdOf("/candidatures/app_rhone")).toBeNull();
  });
});

describe("an Application's page (#691)", () => {
  const read = { application: { id: "app_rhone", jobOffer: { title: "Responsable logistique" } } };

  it("is titled with its Job Offer, as its read gives it, and leads back to Mes candidatures", () => {
    expect(pageFor("/candidatures/app_rhone", t, read)).toEqual({
      key: "/candidatures/app_rhone",
      title: "Responsable logistique",
      pane: "fiche",
      up: { path: "/candidatures", label: "Retour à mes candidatures" },
    });
  });

  it("keeps that title on one of its Sections, and « Candidature » while its read has not answered, never another's", () => {
    expect(pageFor("/candidatures/app_rhone/entretiens", t, read).title).toBe("Responsable logistique");
    expect(pageFor("/candidatures/app_rhone", t).title).toBe("Candidature");
    expect(pageFor("/candidatures/app_aeroline", t, read).title).toBe("Candidature");
  });

  it("names the Application to read from its address, a Section's included, and none on any other page", () => {
    expect(applicationIdOf("/candidatures/app%20rhone/entretiens")).toBe("app rhone");
    expect(applicationIdOf("/candidatures")).toBeNull();
    expect(applicationIdOf("/profils/prof_lyon")).toBeNull();
  });
});
