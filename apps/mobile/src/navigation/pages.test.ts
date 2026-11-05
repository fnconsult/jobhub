import { createI18n, DEFAULT_LOCALE } from "@jobhub/shared/i18n";
import { pageFor, profileIdOf } from "./pages";

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
