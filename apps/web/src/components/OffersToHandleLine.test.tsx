// @vitest-environment jsdom
import { createI18n } from "@jobhub/shared/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OffersToHandleLine } from "./OffersToHandleLine";

const fr = createI18n("fr").t;
const en = createI18n("en").t;

describe("the Job Digest page's line of offers à traiter (#818, ADR-0090)", () => {
  it("says « Il vous reste N offres à traiter », leading to Recherches d'offres", () => {
    render(<OffersToHandleLine count={7} t={fr} />);
    expect(screen.getByRole("link", { name: "Il vous reste 7 offres à traiter" }).getAttribute("href")).toBe("/recherches");
  });

  it("in the singular for one, in English too", () => {
    render(<OffersToHandleLine count={1} t={en} />);
    expect(screen.getByRole("link", { name: "You have 1 job offer left to handle" })).toBeTruthy();
  });

  it("says nothing at zero", () => {
    const { container } = render(<OffersToHandleLine count={0} t={fr} />);
    expect(container.innerHTML).toBe("");
  });
});
