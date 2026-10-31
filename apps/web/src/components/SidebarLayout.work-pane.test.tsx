// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { SidebarLayout } from "./SidebarLayout";

vi.mock("next/navigation", () => ({ usePathname: () => "/compte", useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const FREE = [{ id: "11111111-1111-4111-8111-111111111111", title: "Préparer mon pitch" }];

/** Mon compte under « Conversation au centre », on a phone: the Sidebar is a drawer the Menu button opens. */
function AccountPage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title="Mon compte" version="1.2.3" freeConversations={FREE}>
      <p>Réglages</p>
    </SidebarLayout>
  );
}

const menuButton = () => screen.getByRole("button", { name: "Menu" });
const drawer = () => screen.getByRole("dialog");

/** Opens the drawer, then clicks `name` in it; resolves once the drawer has closed and given the focus away. */
async function openFromDrawer(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(menuButton());
  await user.click(within(drawer()).getByRole("button", { name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Radix gives the focus back from a closed dialog on the next task.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("the Work Pane opened from the Sidebar's drawer, on a phone (#602, ADR-0070)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the Signalement icon beside « Mon compte » closes the drawer and opens its form in the Work Pane, the focus on its title", async () => {
    const user = userEvent.setup();
    renderInFrench(<AccountPage />);

    await openFromDrawer(user, "Signalement");

    const pane = screen.getByRole("complementary", { name: "Envoyer un signalement" });
    expect(pane.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(within(pane).getByRole("heading", { level: 2, name: "Envoyer un signalement" }));
  });

  it("« Mémoire du coach » closes the drawer and opens the Coach Memory in the Work Pane, the focus on its title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [] })));
    const user = userEvent.setup();
    renderInFrench(<AccountPage />);

    await openFromDrawer(user, "Mémoire du coach");

    const pane = screen.getByRole("complementary", { name: "Mémoire du coach" });
    expect(pane.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(within(pane).getByRole("heading", { level: 2, name: "Mémoire du coach" }));
  });

  it("closing the pane opened from the drawer gives the focus back to the Menu button, which opened the drawer", async () => {
    const user = userEvent.setup();
    renderInFrench(<AccountPage />);
    await openFromDrawer(user, "Signalement");
    expect(screen.getByRole("complementary", { name: "Envoyer un signalement" })).toBeTruthy();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(menuButton());
  });
});
