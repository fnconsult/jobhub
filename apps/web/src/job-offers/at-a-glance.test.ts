import { createI18n } from "@jobhub/shared/i18n";
import { describe, expect, it } from "vitest";
import { jobOfferAtAGlance } from "./at-a-glance";

const offer = { title: "Directeur administratif et financier (H/F)", content: "…", source: { url: "https://www.apec.fr/offres/1" } };

describe("a Job Offer at a glance (the lead line under an Application's title)", () => {
  it("joins the employer, location, contract type and salary the posting gives, in the Interface Language", () => {
    const full = { ...offer, employer: "Groupe Ferlac", location: "Villeurbanne (69)", contractType: "cdi" as const, salary: { min: 95_000, max: 110_000 } };
    expect(jobOfferAtAGlance(full, createI18n("fr").t, "fr")).toBe("Groupe Ferlac · Villeurbanne (69) · CDI · De 95 000 à 110 000 € brut par an");
    expect(jobOfferAtAGlance(full, createI18n("en").t, "en")).toMatch(/^Groupe Ferlac · Villeurbanne \(69\) · .+ · .*95,000.*110,000/);
  });

  it("leaves out what the posting does not say", () => {
    expect(jobOfferAtAGlance({ ...offer, location: "Lyon", contractType: "freelance" as const }, createI18n("fr").t, "fr")).toBe("Lyon · Indépendant (freelance)");
    expect(jobOfferAtAGlance(offer, createI18n("fr").t, "fr")).toBeNull();
  });
});
