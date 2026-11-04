import type { ProfileResponse, TailoredDocumentsResponse } from "@jobhub/shared/reads";

/**
 * Sample data, until the app reads the API (ADR-0076: the GETs added to `/api/*`): one Application and two Free
 * conversations, enough to reach every kind of page, and one Job Offer of a Job Search.
 */
export const SAMPLE_APPLICATIONS = [{ id: "a1", title: "Aéroline · Responsable qualité" }] as const;
export const SAMPLE_FREE_CONVERSATIONS = [
  { id: "c1", title: "Me présenter en deux minutes" },
  { id: "c2", title: "Préparer la négociation du salaire" },
] as const;
export const SAMPLE_JOB_OFFERS = [
  { id: "o1", jobSearchId: "r1", title: "Responsable qualité · Aéroline", postingUrl: "https://www.example.com/offres/aeroline-responsable-qualite" },
] as const;

/** The Tailored Documents of each sample Application, as `GET /api/applications/:id/documents` answers them (#684). */
export const SAMPLE_TAILORED_DOCUMENTS: Readonly<Record<string, TailoredDocumentsResponse>> = {
  a1: {
    documentLanguage: "fr",
    documents: [
      {
        kind: "tailored_cv",
        language: "fr",
        updatedAt: "2026-11-02T10:15:00.000Z",
        downloads: { pdf: "/api/applications/a1/tailored-cv/export?format=pdf&template=classic", docx: "/api/applications/a1/tailored-cv/export?format=docx&template=classic" },
        message: null,
      },
      {
        kind: "cover_letter",
        language: "fr",
        updatedAt: "2026-11-02T10:40:00.000Z",
        downloads: { pdf: "/api/applications/a1/cover-letter/export?format=pdf&template=classic", docx: "/api/applications/a1/cover-letter/export?format=docx&template=classic" },
        message: null,
      },
      {
        kind: "outreach_message",
        language: "fr",
        updatedAt: "2026-11-03T08:05:00.000Z",
        downloads: null,
        message: {
          subject: "Candidature au poste de responsable qualité",
          text: "Bonjour,\n\nResponsable qualité depuis huit ans dans l'aéronautique, j'ai vu votre offre et j'aimerais en parler avec vous.\n\nBien à vous,\nMarie Dupont",
        },
      },
    ],
  },
};

const MARIE = {
  fullName: "Marie Dupont",
  email: "marie.dupont@example.fr",
  phone: "",
  location: "Toulouse",
  experience: [{ title: "Responsable qualité", employer: "Aérostructures du Sud", location: "Toulouse", period: "2018 – 2026", description: "Certification EN 9100." }],
  education: [],
  languages: [],
};

/** The sample Candidate's Profiles, as `GET /api/profiles/:id` answers them (#684); `GET /api/profiles` names them. */
export const SAMPLE_PROFILES: readonly ProfileResponse[] = [
  {
    id: "p1",
    name: "Qualité aéronautique",
    archived: false,
    searchCriteria: {
      targetRole: "Responsable qualité",
      locations: ["Toulouse", "Bordeaux"],
      minSalary: 55000,
      contractTypes: ["cdi", "cdd"],
      remoteWorkOptions: ["hybrid"],
      sectors: ["Aéronautique"],
      subsectors: [],
      domains: [],
    },
    masterCv: { version: 3, content: { ...MARIE, headline: "Responsable qualité aéronautique, EN 9100 et Part 21", summary: "Huit ans de qualité en production aéronautique.", skills: ["EN 9100", "Part 21", "Audit"] } },
    atsScore: 82,
  },
  {
    id: "p2",
    name: "Direction des opérations",
    archived: false,
    searchCriteria: { targetRole: "Directrice des opérations", locations: [], contractTypes: [], remoteWorkOptions: [], sectors: [], subsectors: [], domains: [] },
    masterCv: { version: 1, content: { ...MARIE, headline: "", summary: "", skills: [] } },
    atsScore: null,
  },
];
