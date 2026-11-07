import type { FoundJobOffer } from "@jobhub/shared/reads";

/** A Job Offer a Job Search found, as `GET /api/job-searches/:id` gives it: Match Score 86, not followed. */
export function found(id: string, overrides: Partial<FoundJobOffer> = {}): FoundJobOffer {
  return {
    jobOffer: {
      id,
      title: `Offre ${id}`,
      employer: "Acme Industrie",
      location: "Lyon",
      url: `https://www.example.com/${id}`,
      postedAt: null,
      expiredAt: null,
      contractType: "cdi",
      summary: "Piloter la consolidation IFRS d'un groupe industriel.",
      content: "Vous pilotez la consolidation IFRS sous SAP.",
    },
    matchScore: 86,
    matchScoreDetail: {
      skills: { status: "partial", covered: ["IFRS"], missing: ["SAP"] },
      seniority: { status: "unknown", cvYears: null, requiredYears: null },
      location: { status: "match", offer: "Lyon", wanted: ["Lyon"] },
      salary: { status: "unknown", offerMin: null, offerMax: null, wanted: null },
      contractType: { status: "match", offer: "cdi", wanted: ["cdi"] },
    },
    decision: null,
    applicationId: null,
    ...overrides,
  };
}
