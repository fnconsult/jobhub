// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ApplicationProfileSelect } from "./ApplicationControls";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const PROFILES = [
  { id: "p1", name: "DAF" },
  { id: "p2", name: "Consultante finance" },
];

describe("the Profile an Application uses, in its fiche (#716)", () => {
  it("has an « Origine » disclosure when a Coach proposal the Candidate applied gave it", () => {
    const { container } = renderInFrench(
      <dl>
        <ApplicationProfileSelect applicationId="a1" profileId="p2" profiles={PROFILES} appliedFromCoach="2026-11-05T09:30:00.000Z" />
      </dl>,
    );

    expect(screen.getByRole("combobox", { name: "Profil utilisé" })).toHaveProperty("value", "p2");
    expect(container.querySelector("details.origin-disclosure")?.textContent).toContain("Sur proposition de votre coach IA, appliqué par vous le 5 novembre 2026 à 10:30");
  });

  it("has none for a Profile the Candidate chose themselves", () => {
    const { container } = renderInFrench(
      <dl>
        <ApplicationProfileSelect applicationId="a1" profileId="p1" profiles={PROFILES} />
      </dl>,
    );
    expect(container.querySelector("details.origin-disclosure")).toBeNull();
  });
});
