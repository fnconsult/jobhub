// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { currentStep, Stepper, type Step } from "./Stepper";
import { renderInFrench } from "./testing";

const steps: Step[] = [
  { id: "read", title: "Lecture de votre profil", status: "done", detail: "Directrice financière · Lyon" },
  { id: "search", title: "Recherche des offres", status: "current" },
  { id: "select", title: "Sélection de vos meilleures offres", status: "pending" },
];

describe("the Stepper (#1001)", () => {
  it("lists the steps in order, each one's state said in words, the step under way marked as the current step", () => {
    renderInFrench(<Stepper steps={steps} label="Étapes" />);

    const list = screen.getByRole("list", { name: "Étapes" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Lecture de votre profil (terminé)Directrice financière · Lyon",
      "Recherche des offres (en cours)",
      "Sélection de vos meilleures offres (à venir)",
    ]);
    expect(list.querySelector('[aria-current="step"]')!.textContent).toBe("Recherche des offres (en cours)");
  });

  it("gives the step under way with its number, or none", () => {
    expect(currentStep(steps)).toEqual({ step: steps[1], number: 2 });
    expect(currentStep(steps.map((step) => ({ ...step, status: "done" as const })))).toBeNull();
  });
});
