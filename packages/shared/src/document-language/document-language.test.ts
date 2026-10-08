import { describe, expect, it } from "vitest";
import { jobOfferLanguage } from "./index";

describe("the Document Language a Job Offer defaults to", () => {
  it("is French for a posting written in French", () => {
    expect(
      jobOfferLanguage({
        title: "Directeur administratif et financier H/F",
        content: "Rattaché au directeur général, vous pilotez la consolidation et le contrôle de gestion du groupe. Vous avez 15 ans d'expérience dans la finance.",
      }),
    ).toBe("fr");
  });

  it("is English for a posting written in English", () => {
    expect(
      jobOfferLanguage({
        title: "Chief Financial Officer",
        content: "Reporting to the CEO, you will lead the finance team and own the group consolidation. You have 15 years of experience in finance and you are fluent in French.",
      }),
    ).toBe("en");
  });

  it("is French, the French market's language, when the posting says too little to tell", () => {
    expect(jobOfferLanguage({ title: "CFO", content: "SAP, IFRS" })).toBe("fr");
  });
});
