// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/design/testing";
import { SectionsLayout } from "./SectionsLayout";

let pathname = "/compte";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const SECTIONS = [
  { href: "/compte/identite", label: "Identité" },
  { href: "/compte/profils", label: "Profils" },
];

const currentLinks = () => screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent);

describe("SectionsLayout, a page split into Sections (ADR-0024)", () => {
  beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the first Section at the page's own address", () => {
    pathname = "/compte";
    render(<SectionsLayout base="/compte" label="Rubriques" backLabel="Mon compte" sections={SECTIONS}>…</SectionsLayout>);

    expect(currentLinks()).toEqual(["Identité"]);
  });

  it("shows the Section `baseShows` names there instead, wherever it is listed (Mon compte's Profils under Identité, #918)", () => {
    pathname = "/compte";
    render(
      <SectionsLayout base="/compte" baseShows="/compte/profils" label="Rubriques" backLabel="Mon compte" sections={SECTIONS}>
        …
      </SectionsLayout>,
    );

    expect(currentLinks()).toEqual(["Profils"]);
  });

  it("shows the Section at its own address", () => {
    pathname = "/compte/identite";
    render(<SectionsLayout base="/compte" baseShows="/compte/profils" label="Rubriques" backLabel="Mon compte" sections={SECTIONS}>…</SectionsLayout>);

    expect(currentLinks()).toEqual(["Identité"]);
  });
});
