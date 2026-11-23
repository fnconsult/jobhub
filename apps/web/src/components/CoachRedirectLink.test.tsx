// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInFrench } from "@/design/testing";
import { CoachRedirectLink } from "./CoachRedirectLink";

describe("CoachRedirectLink, a reply's Typed redirect (ADR-0114)", () => {
  it("shows « page › section › object » under the reply as one link to the page the server built", () => {
    renderInFrench(<CoachRedirectLink redirect={{ page: "Profil Finance", section: "CV de référence", object: "Langues", href: "/profils/p1/cv" }} />);

    expect(screen.getByText("Où le faire vous-même :")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Profil Finance › CV de référence › Langues" }).getAttribute("href")).toBe("/profils/p1/cv");
  });

  it("leaves out a Section the object is in none of", () => {
    renderInFrench(<CoachRedirectLink redirect={{ page: "Créer un profil", section: null, object: "Nouveau profil", href: "/profils/nouveau" }} />);

    expect(screen.getByRole("link", { name: "Créer un profil › Nouveau profil" })).toBeTruthy();
  });

  it("shows nothing for a link elsewhere than one of Jobbbox's pages", () => {
    const { container } = renderInFrench(<CoachRedirectLink redirect={{ page: "Ailleurs", section: null, object: "x", href: "//example.org" }} />);

    expect(container.textContent).toBe("");
  });
});
