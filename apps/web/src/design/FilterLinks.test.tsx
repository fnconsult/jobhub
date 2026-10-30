// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FilterLinks } from "./FilterLinks";
import { renderInFrench } from "./testing";

describe("FilterLinks (#466)", () => {
  it("offers each filter as a link in a navigation named by its label, the one shown marked as the page", () => {
    renderInFrench(
      <FilterLinks
        label="Filtrer par type"
        shown="bug"
        links={[
          { id: "all", href: "/admin/signalements", label: "Tous les types" },
          { id: "bug", href: "/admin/signalements?type=bug", label: "Bug" },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Filtrer par type" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Tous les types", "Bug"]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([null, "page"]);
    expect(links[1]!.getAttribute("href")).toBe("/admin/signalements?type=bug");
  });
});
