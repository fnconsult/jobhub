// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ExternalLink } from "./ExternalLink";

const pathname = { current: "/candidatures/1" };
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("ExternalLink", () => {
  it("leads a link out of Jobbbox to the Exit Page of its shell, in a new tab, keeping the referrer", () => {
    renderInFrench(<ExternalLink href="https://example.com/offre">Voir l&apos;offre</ExternalLink>);
    const link = screen.getByRole("link", { name: "Voir l'offre" });
    expect(link.getAttribute("href")).toBe("/sortie?url=https%3A%2F%2Fexample.com%2Foffre");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener nofollow");
  });

  it("uses the Back Office's Exit Page under /admin, and can stay in the tab", () => {
    pathname.current = "/admin/coachs";
    renderInFrench(
      <ExternalLink href="https://cal.example/coach" newTab={false}>
        Réserver
      </ExternalLink>,
    );
    const link = screen.getByRole("link", { name: "Réserver" });
    expect(link.getAttribute("href")).toBe("/admin/sortie?url=https%3A%2F%2Fcal.example%2Fcoach");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("draws a link that stays in Jobbbox as given", () => {
    renderInFrench(<ExternalLink href="mailto:contact@jobbbox.ai">Contact</ExternalLink>);
    expect(screen.getByRole("link", { name: "Contact" }).getAttribute("href")).toBe("mailto:contact@jobbbox.ai");
  });
});
