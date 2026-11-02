// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import type { UnfoldedMenu } from "@/sidebar-menus";
import { SidebarLayout } from "./SidebarLayout";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const PROFILE = { id: "11111111-1111-4111-8111-111111111111", name: "DAF", archived: false };
const SEARCH = "22222222-2222-4222-8222-222222222222";
const DIGEST = "33333333-3333-4333-8333-333333333333";

const JOB_SEARCHES: UnfoldedMenu = { shown: [{ id: SEARCH, label: "DAF · 12 oct.", href: `/recherches/${SEARCH}`, toHandle: true }], total: 4 };
const JOB_DIGESTS: UnfoldedMenu = { shown: [{ id: DIGEST, label: "DAF · 19 oct.", href: `/job-digests/${DIGEST}`, toHandle: false }], total: 1 };

function Page() {
  return (
    <SidebarLayout profiles={[PROFILE]} canAddProfile={false} title="Accueil" version="1.2.3" freeConversations={[]} menus={{ jobSearches: JOB_SEARCHES, jobDigests: JOB_DIGESTS }}>
      <p>Page</p>
    </SidebarLayout>
  );
}

const sidebar = () => screen.getAllByRole("navigation").find((nav) => within(nav).queryByRole("link", { name: "Recherches d'offres" }))!;
const linksOf = (list: HTMLElement) => within(list).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);

describe("the Sidebar's Recherches d'offres and Job Digests unfold into their objects (#606, ADR-0070)", () => {
  beforeEach(() => {
    pathname.current = "/";
    window.localStorage.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("unfolds Recherches d'offres into its Job Searches, those unseen marked, then « Tout voir (N) » to its page", () => {
    renderInFrench(<Page />);
    expect(linksOf(within(sidebar()).getByRole("list", { name: "Recherches d'offres" }))).toEqual([
      ["DAF · 12 oct., à traiter", `/recherches/${SEARCH}`],
      ["Tout voir (4)", "/recherches"],
    ]);
  });

  it("unfolds Job Digests into its Job Digests, then « Tout voir (N) »", () => {
    renderInFrench(<Page />);
    expect(linksOf(within(sidebar()).getByRole("list", { name: "Job Digests" }))).toEqual([
      ["DAF · 19 oct.", `/job-digests/${DIGEST}`],
      ["Tout voir (1)", "/job-digests"],
    ]);
  });

  it("highlights the Job Search open rather than Recherches d'offres", () => {
    pathname.current = `/recherches/${SEARCH}`;
    renderInFrench(<Page />);
    expect(within(sidebar()).getByRole("link", { name: /DAF · 12 oct\./ }).getAttribute("aria-current")).toBe("page");
    expect(within(sidebar()).getByRole("link", { name: "Recherches d'offres" }).getAttribute("aria-current")).toBeNull();
  });

  it("leads Recherches d'offres to its menu's page, the Profile left to the conversation", () => {
    renderInFrench(<Page />);
    expect(within(sidebar()).getByRole("link", { name: "Recherches d'offres" }).getAttribute("href")).toBe("/recherches");
  });

});
