// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderInFrench } from "@/design/testing";
import { PublicCoachProfile } from "./PublicCoachProfile";

it("writes « Spécialités : » and « Langues : » with the non-breaking space French puts before a colon (#1020)", () => {
  renderInFrench(<PublicCoachProfile name="Sophie Martin" page={{ presentation: "Ancienne DRH.", specialties: ["Finance", "Transition de carrière"], languages: ["Français"], photoUrl: null }} />);
  expect(screen.getByText(/^Spécialités/).textContent).toBe("Spécialités : Finance, Transition de carrière");
  expect(screen.getByText(/^Langues/).textContent).toBe("Langues : Français");
});
