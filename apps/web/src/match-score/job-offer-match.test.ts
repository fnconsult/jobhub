import type { JobOffer, MasterCvContent } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import type { Profile } from "../profiles";
import { jobOfferMatch } from "./job-offer-match";

const masterCv: MasterCvContent = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Lyon",
  summary: "",
  experience: [{ title: "Directrice financière", employer: "Groupe Seb", location: "Lyon", period: "2005 – 2024", description: "Consolidation IFRS." }],
  education: [],
  skills: ["IFRS", "SAP"],
  languages: [],
};

const jobOffer: JobOffer = {
  id: "offer-1",
  source: { url: "https://www.apec.fr/offre/1" },
  title: "DAF H/F",
  content: "DAF pour un groupe industriel. 15 ans d'expérience.",
  location: "Lyon",
  contractType: "cdi",
  salary: { min: 110_000, max: 130_000 },
  skills: ["IFRS", "SAP", "Power BI"],
};

function profile(id: string, name: string, minSalary: number, archived = false): Profile {
  return { id, name, archived, searchCriteria: { targetRole: "DAF", locations: ["Lyon"], minSalary, contractTypes: ["cdi"], remoteWorkOptions: [] }, masterCv: { version: 1, content: masterCv } };
}

// Skills 2/3 of 40, seniority 20, location 15, contract type 15, salary 10 (out of 100):
// 87 when the offer's salary reaches the Profile's minimum, 77 when it falls short.
const daf = profile("p-daf", "DAF", 120_000);
const ambitious = profile("p-ambitious", "DAF grand groupe", 150_000);
const archived = profile("p-archived", "Contrôleur de gestion", 120_000, true);

describe("jobOfferMatch: the Match Score a Job Offer page shows a signed-in Candidate", () => {
  it("scores the Job Offer against each active Profile, preselecting the first", () => {
    const match = jobOfferMatch({ jobOffer, profiles: [daf, archived, ambitious], applications: [] });

    expect(match).toMatchObject({
      saved: false,
      profileId: "p-daf",
      matches: [
        { profile: { id: "p-daf", name: "DAF" }, matchScore: { score: 87 } },
        { profile: { id: "p-ambitious", name: "DAF grand groupe" }, matchScore: { score: 77, breakdown: { salary: { status: "mismatch" } } } },
      ],
    });
  });

  it("preselects the Profile the Candidate came with (a Job Search's), when it is active", () => {
    const profiles = [daf, archived, ambitious];

    expect(jobOfferMatch({ jobOffer, profiles, applications: [], profileId: "p-ambitious" })).toMatchObject({ saved: false, profileId: "p-ambitious" });
    expect(jobOfferMatch({ jobOffer, profiles, applications: [], profileId: "p-archived" })).toMatchObject({ saved: false, profileId: "p-daf" });
    expect(jobOfferMatch({ jobOffer, profiles, applications: [], profileId: "someone-else" })).toMatchObject({ saved: false, profileId: "p-daf" });
  });

  it("once saved, shows its Application's Match Score, against the Application's Profile, whichever was asked", () => {
    const applications = [
      { id: "app-other", jobOffer: { id: "offer-2" }, profile: { id: "p-daf" } },
      { id: "app-1", jobOffer: { id: "offer-1" }, profile: { id: "p-ambitious" } },
    ];

    expect(jobOfferMatch({ jobOffer, profiles: [daf, ambitious], applications, profileId: "p-daf" })).toMatchObject({
      saved: true,
      applicationId: "app-1",
      profile: { id: "p-ambitious", name: "DAF grand groupe" },
      matchScore: { score: 77 },
    });
  });

  it("scores a saved Job Offer against its Application's Profile even once that Profile is archived", () => {
    const applications = [{ id: "app-1", jobOffer: { id: "offer-1" }, profile: { id: "p-archived" } }];

    expect(jobOfferMatch({ jobOffer, profiles: [daf, archived], applications })).toMatchObject({
      saved: true,
      applicationId: "app-1",
      profile: { id: "p-archived" },
      matchScore: { score: 87 },
    });
  });

  it("has nothing to show a Candidate without an active Profile", () => {
    expect(jobOfferMatch({ jobOffer, profiles: [archived], applications: [] })).toBeNull();
    expect(jobOfferMatch({ jobOffer, profiles: [], applications: [] })).toBeNull();
  });
});
