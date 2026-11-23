// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { TailoredCvReview, type TailoredCv } from "./TailoredCvReview";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/candidatures/a1/documents" }));

const content = {
  fullName: "Marie Dupont",
  headline: "Directrice financière",
  email: "",
  phone: "",
  location: "Lyon",
  summary: "25 ans dans l'industrie.",
  experience: [],
  education: [],
  skills: ["IFRS", "SQL"],
  languages: [],
};

const saved = (origin?: { appliedAt: string } | null): TailoredCv => ({
  documentLanguage: "fr",
  proposal: null,
  saved: { language: "fr", content, matchScore: { master: 60, tailored: 70 }, savedAt: "2026-11-23T10:00:00.000Z", provenance: null, ...(origin !== undefined ? { origin } : {}) },
});

describe("the saved Tailored CV's « Origine » (ADR-0113, #1097)", () => {
  it("is shown when it was saved from a Coach proposal's card", () => {
    renderInFrench(<TailoredCvReview applicationId="a1" initial={saved({ appliedAt: "2026-11-23T10:00:00.000Z" })} language="fr" locale="fr-FR" />);
    expect(screen.getByText("Origine")).toBeTruthy();
  });

  it("is not there when the Candidate saved it from a proposal", () => {
    renderInFrench(<TailoredCvReview applicationId="a1" initial={saved(null)} language="fr" locale="fr-FR" />);
    expect(screen.queryByText("Origine")).toBeNull();
  });
});
