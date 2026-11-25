// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ApplicationTitle } from "./ApplicationTitle";
import { SidebarLayout } from "./SidebarLayout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/candidatures/a1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const FICHE = { card: <p>Exemple Digital · Issy-les-Moulineaux</p>, sections: [], results: [] };
const SLOGAN = "Building tomorrow, together";
const TITLE = "Senior Program Director – Delivery Management";

/** An Application's page, its conversation titled by the Application, as app/candidatures/[id]/conversation.tsx gives it (#1130). */
function ApplicationPage() {
  return (
    <SidebarLayout profiles={[]} canAddProfile={false} title={<ApplicationTitle applicationId="a1" title={SLOGAN} />} version="1.2.3" freeConversations={[]} fiche={FICHE}>
      <p>Conversation</p>
    </SidebarLayout>
  );
}

/** A screen `rem` wide, as the media queries see it. */
function screenWidth(rem: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const [, op, limit] = /\(width (<|>=) ([\d.]+)rem\)/.exec(query) ?? [];
    return { matches: op === "<" ? rem < Number(limit) : rem >= Number(limit), media: query, addEventListener: () => {}, removeEventListener: () => {} };
  });
}

const topBar = () => screen.getByRole("banner");
const field = () => within(topBar()).getByRole("textbox", { name: "Intitulé de la candidature" });

describe("« Renommer » an Application's conversation (#1130): its title in the Top Bar, never gone again", () => {
  let fetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    fetch = vi.fn(async () => new Response(JSON.stringify({ id: "a1" }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renames the Application in place from the Top Bar's title: PATCH { title }, for this Candidate only", async () => {
    screenWidth(100);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    expect(within(topBar()).getByRole("heading", { level: 1 })).toBeTruthy();
    expect(field()).toHaveProperty("value", SLOGAN);
    expect(field().getAttribute("title")).toBe("Pour vous seulement : l'offre garde son intitulé pour les autres.");
    await user.clear(field());
    await user.type(field(), `${TITLE}{Enter}`);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/applications/a1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ title: TITLE }) })));
    expect(await screen.findByText("Intitulé enregistré")).toBeTruthy();
  });

  it("offers « Renommer » under « … » on a phone, which puts the focus in the title", async () => {
    screenWidth(24.375);
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    within(topBar()).getByRole("button", { name: "Autres actions" }).focus();
    await user.keyboard("{Enter}");
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Renommer" }));

    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("says why a title is refused", async () => {
    screenWidth(100);
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ field: "title", code: "too_long" }] }), { status: 400 }));
    const user = userEvent.setup();
    renderInFrench(<ApplicationPage />);

    await user.type(field(), " encore{Enter}");

    expect(await screen.findByText(/200/)).toBeTruthy();
  });
});
