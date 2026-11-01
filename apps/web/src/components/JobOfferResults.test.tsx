// @vitest-environment jsdom
import type { JobOffer, MatchScore } from "@jobhub/shared";
import { createI18n } from "@jobhub/shared/i18n";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { JobOfferResults } from "./JobOfferResults";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/recherches/s1" }));

const t = createI18n("fr").t;
const matchScore = {
  score: 86,
  breakdown: {
    skills: { status: "match", covered: ["WMS"], missing: [] },
    seniority: { status: "unknown" },
    location: { status: "unknown" },
    salary: { status: "unknown" },
    contractType: { status: "unknown" },
  },
} as MatchScore;
const jobOffer = { id: "o1", title: "Responsable logistique", employer: "Acme Industrie", source: { url: "https://www.apec.fr/offres/1" } } as JobOffer;

describe("Job Offers found for a Profile", () => {
  it("lead to the Job Offer's page by default, its Match Score against that Profile", () => {
    renderInFrench(<JobOfferResults results={[{ jobOffer, matchScore, applicationId: null }]} profileId="p1" t={t} locale="fr" />);
    expect(screen.getByRole("link", { name: "Responsable logistique" }).getAttribute("href")).toBe("/offres/o1?profil=p1");
    expect(screen.getByRole("link", { name: "Lire l'offre" }).getAttribute("href")).toBe("/offres/o1?profil=p1");
  });

  it("lead where the page says, under « Conversation au centre » the Work Pane beside its conversation (#605)", () => {
    renderInFrench(
      <JobOfferResults results={[{ jobOffer, matchScore, applicationId: null }]} profileId="p1" t={t} locale="fr" offerHref={(id) => `/recherches/s1/offres/${id}`} />,
    );
    expect(screen.getByRole("link", { name: "Responsable logistique" }).getAttribute("href")).toBe("/recherches/s1/offres/o1");
    expect(screen.getByRole("link", { name: "Lire l'offre" }).getAttribute("href")).toBe("/recherches/s1/offres/o1");
  });
});
