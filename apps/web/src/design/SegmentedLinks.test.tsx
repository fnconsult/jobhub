// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SegmentedLinks } from "./SegmentedLinks";
import { renderInFrench } from "./testing";

describe("SegmentedLinks (#469)", () => {
  it("offers each view as a link of one segmented control, in a navigation named by its label, the one shown marked as the page", () => {
    renderInFrench(
      <SegmentedLinks
        label="Affichage de l'agenda"
        shown="semaine"
        links={[
          { id: "liste", href: "/agenda?vue=liste", label: "Liste" },
          { id: "semaine", href: "/agenda?vue=semaine", label: "Semaine" },
          { id: "mois", href: "/agenda?vue=mois", label: "Mois" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Affichage de l'agenda" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Liste", "Semaine", "Mois"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "page", null]);
    expect(links[2]!.getAttribute("href")).toBe("/agenda?vue=mois");
    // Drawn as the Design System's segmented control.
    expect(nav.querySelector(".ds-segmented")).not.toBeNull();
    expect(links.every((link) => link.classList.contains("ds-segmented__option"))).toBe(true);
  });
});
