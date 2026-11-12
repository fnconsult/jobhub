// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { AiActivityProvider } from "./AiActivity";
import { Fiche, FicheButtons, FicheProvider, panelViews, type FicheContent } from "./Fiche";
import { InWorkPane, WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/candidatures/a1/entretiens",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const CONTENT: FicheContent = {
  card: <p>Ledger · Paris</p>,
  sections: [
    { href: "/candidatures/a1/offre", label: "L'offre" },
    { href: "/candidatures/a1/entretiens", label: "Entretiens" },
  ],
  results: [{ href: "/candidatures/a1/documents?resultat=cover_letter", label: "Lettre de motivation", detail: "Brouillon du 12 octobre 2026" }],
};

function Page({ content = CONTENT }: { content?: FicheContent }) {
  return (
    <AiActivityProvider>
      <FicheProvider views={panelViews(content)}>
        <header>
          <FicheButtons content={content} />
        </header>
        <main />
        <Fiche content={content} />
      </FicheProvider>
    </AiActivityProvider>
  );
}

const topBar = () => screen.getByRole("banner");
const panel = (name: string) => screen.getByRole("complementary", { name });
const fiche = () => panel("Fiche");
const icon = (name: string) => within(topBar()).getByRole("button", { name });

describe("the side panel and its views (#980, ADR-0070)", () => {
  it("opens on the Fiche on a wide screen: its head names the view and has « Fermer le volet », then the card and the Sections", () => {
    renderInFrench(<Page />);

    expect(within(fiche()).getByRole("heading", { level: 2, name: "Fiche" })).toBeTruthy();
    expect(within(fiche()).getByRole("button", { name: "Fermer le volet" })).toBeTruthy();
    expect(within(fiche()).getByText("Ledger · Paris")).toBeTruthy();
    expect(within(fiche()).getByRole("region", { name: "Sections" })).toBeTruthy();
    // The Activity and the Results are views of their own now.
    expect(within(fiche()).queryByRole("region", { name: "Historique" })).toBeNull();
    expect(within(fiche()).queryByRole("link", { name: /Lettre de motivation/ })).toBeNull();
  });

  it("links each Section to its address, the one open marked as the current page", () => {
    renderInFrench(<Page />);

    expect(within(fiche()).getByRole("link", { name: "L'offre" }).getAttribute("href")).toBe("/candidatures/a1/offre");
    expect(within(fiche()).getByRole("link", { name: "Entretiens" }).getAttribute("aria-current")).toBe("page");
    expect(within(fiche()).getByRole("link", { name: "L'offre" }).getAttribute("aria-current")).toBeNull();
  });

  it("has one icon per view in the Top Bar, in order, the one shown pressed; its own icon closes it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const views = within(topBar()).getByRole("group", { name: "Volet de la page" });
    expect(
      within(views)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.getAttribute("title")),
    ).toEqual(["Activité IA", "Fiche", "Documents", "Plus d'actions sur le volet"]);
    expect(icon("Fiche").getAttribute("aria-expanded")).toBe("true");
    expect(icon("Fiche").getAttribute("title")).toBe("Fiche");

    await user.click(icon("Documents"));
    expect(screen.queryByRole("complementary", { name: "Fiche" })).toBeNull();
    const documents = panel("Documents");
    expect(icon("Documents").getAttribute("aria-expanded")).toBe("true");
    expect(icon("Fiche").getAttribute("aria-expanded")).toBe("false");
    const letter = within(documents).getByRole("link", { name: /Lettre de motivation/ });
    expect(letter.getAttribute("href")).toBe("/candidatures/a1/documents?resultat=cover_letter");
    expect(letter.textContent).toContain("Brouillon du 12 octobre 2026");

    await user.click(icon("Documents"));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(icon("Documents").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows « Activité » with AI Activity's icon: the page's AI Activity, then its latest Results", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const activity = icon("Activité IA");

    await user.click(activity);

    const view = panel("Activité");
    expect(activity.getAttribute("aria-expanded")).toBe("true");
    expect(within(view).getByText(/Rien encore sur cette page/)).toBeTruthy();
    expect(within(view).getByRole("region", { name: "Résultats" })).toBeTruthy();
    expect(within(view).getByRole("link", { name: /Lettre de motivation/ })).toBeTruthy();
    // « Sources et outils de cette page » is gone (#980).
    expect(within(view).queryByText(/Sources et outils/)).toBeNull();
    // « En savoir plus » leads to « IA dans Jobbbox » (#338).
    expect(within(view).getByRole("link", { name: "En savoir plus sur l'IA dans Jobbbox" }).getAttribute("href")).toBe("/legal/confidentialite#ia");

    await user.click(activity);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("lists the three latest Results in « Activité », « Tout voir » showing them all", async () => {
    const user = userEvent.setup();
    const results = ["CV adapté", "Lettre de motivation", "Message d'approche", "Relance"].map((label, index) => ({ href: `/r/${index}`, label }));
    renderInFrench(<Page content={{ ...CONTENT, results }} />);
    await user.click(icon("Activité IA"));
    const latest = within(panel("Activité")).getByRole("region", { name: /Résultats/ });
    expect(within(latest).getAllByRole("link").map((link) => link.textContent)).toEqual(["CV adapté", "Lettre de motivation", "Message d'approche"]);

    await user.click(within(latest).getByRole("button", { name: "Tout voir" }));

    expect(within(panel("Documents")).getAllByRole("link")).toHaveLength(4);
  });

  it("says so when there is no Result yet", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page content={{ ...CONTENT, results: [] }} />);

    await user.click(icon("Documents"));

    expect(within(panel("Documents")).getByText(/Aucun résultat pour l'instant/)).toBeTruthy();
  });

  it("names the Results « Offres trouvées » for a Job Search, and offers « L'offre » for an Application only", () => {
    renderInFrench(<Page content={{ ...CONTENT, resultsLabel: "offers" }} />);
    expect(icon("Offres trouvées")).toBeTruthy();
    expect(within(topBar()).queryByRole("button", { name: "L'offre" })).toBeNull();
  });

  it("closes with its ✕, the focus back on the icon that opened it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    await user.click(icon("Documents"));

    await user.click(within(panel("Documents")).getByRole("button", { name: "Fermer le volet" }));

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(icon("Documents"));
  });

  it("goes from one icon to the next with the arrows", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    icon("Fiche").focus();

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(icon("Documents"));
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(icon("Activité IA"));
  });

  it("shows a view with Alt+Shift and its letter, wherever the focus is", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);

    await user.keyboard("{Alt>}{Shift>}d{/Shift}{/Alt}");
    expect(panel("Documents")).toBeTruthy();
    await user.keyboard("{Alt>}{Shift>}a{/Shift}{/Alt}");
    expect(panel("Activité")).toBeTruthy();
    await user.keyboard("{Alt>}{Shift>}a{/Shift}{/Alt}");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes from « … », and goes back to its default width there", async () => {
    const user = userEvent.setup();
    localStorage.setItem("jobbbox.fiche-width", "480");
    renderInFrench(<Page />);

    await user.click(icon("Plus d'actions sur le volet"));
    await user.click(await screen.findByRole("menuitem", { name: "Largeur du volet par défaut" }));
    expect(localStorage.getItem("jobbbox.fiche-width")).toBeNull();

    await user.click(icon("Plus d'actions sur le volet"));
    await user.click(await screen.findByRole("menuitem", { name: "Fermer le volet" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    // Closed, « … » has nothing to offer.
    expect(within(topBar()).queryByRole("button", { name: "Plus d'actions sur le volet" })).toBeNull();
  });
});

describe("an Application's « L'offre » (#980)", () => {
  it("shows its Job Offer in a view of its own", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page content={{ ...CONTENT, offer: <p>Product Owner IA chez Ledger</p> }} />);

    await user.click(icon("L'offre"));

    expect(within(panel("L'offre")).getByText("Product Owner IA chez Ledger")).toBeTruthy();
  });
});

/** A screen `rem` wide: matchMedia answers its `(width >= …rem)` and `(width < …rem)` queries as the browser would. */
function screenOf(rem: number) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: [...query.matchAll(/\(width (>=|<) ([\d.]+)rem\)/g)].every(([, op, bound]) => (op === ">=" ? rem >= Number(bound) : rem < Number(bound))),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** The Interviews Section's page: the Application's page, the Section shown in the Work Pane, the Fiche after it. */
function SectionPage() {
  return (
    <AiActivityProvider>
      <WorkPaneProvider version="1.2.3">
        <FicheProvider>
          <header>
            <FicheButtons />
          </header>
          <main>
            <InWorkPane kind="section" title="Entretiens" href="/candidatures/a1/entretiens" back="/candidatures/a1">
              <p>Mardi 4 novembre, 10 h</p>
            </InWorkPane>
          </main>
          <WorkPane />
          <Fiche content={CONTENT} />
        </FicheProvider>
      </WorkPaneProvider>
    </AiActivityProvider>
  );
}

const pane = () => screen.queryByRole("complementary", { name: "Entretiens" });
const shownFiche = () => screen.queryByRole("complementary", { name: "Fiche" });

describe("the side panel giving way to the Work Pane on a narrower screen (#603, ADR-0070)", () => {
  beforeEach(() => push.mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.sidebar;
  });

  it("is hidden while a Section is open on a laptop's screen with the Sidebar, its icons saying so", async () => {
    screenOf(80);
    renderInFrench(<SectionPage />);

    expect(await screen.findByText("Mardi 4 novembre, 10 h")).toBeTruthy();
    expect(shownFiche()).toBeNull();
    expect(within(topBar()).getByRole("button", { name: "Fiche" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(topBar()).getByRole("button", { name: "Activité IA" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("comes back with « Fiche », which closes the Work Pane and keeps the focus", async () => {
    const user = userEvent.setup();
    screenOf(80);
    renderInFrench(<SectionPage />);
    await screen.findByText("Mardi 4 novembre, 10 h");
    const button = within(topBar()).getByRole("button", { name: "Fiche" });

    await user.click(button);

    expect(pane()).toBeNull();
    expect(push).toHaveBeenCalledWith("/candidatures/a1", { scroll: false });
    expect(shownFiche()).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(button);

    await user.click(button);
    expect(shownFiche()).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("comes back on « Activité » with AI Activity's icon, which closes the Work Pane", async () => {
    const user = userEvent.setup();
    screenOf(80);
    renderInFrench(<SectionPage />);
    await screen.findByText("Mardi 4 novembre, 10 h");
    const activity = within(topBar()).getByRole("button", { name: "Activité IA" });

    await user.click(activity);

    expect(pane()).toBeNull();
    expect(screen.getByRole("complementary", { name: "Activité" })).toBeTruthy();
    expect(activity.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(activity);
  });

  it("stays beside the Work Pane where there is room for both: a wider screen, or the Sidebar hidden", async () => {
    screenOf(110);
    const { unmount } = renderInFrench(<SectionPage />);
    await screen.findByText("Mardi 4 novembre, 10 h");
    expect(shownFiche()).not.toBeNull();
    expect(within(topBar()).getByRole("button", { name: "Fiche" }).getAttribute("aria-expanded")).toBe("true");
    unmount();

    screenOf(80);
    document.documentElement.dataset.sidebar = "closed";
    renderInFrench(<SectionPage />);
    await screen.findByText("Mardi 4 novembre, 10 h");
    expect(shownFiche()).not.toBeNull();
    expect(within(topBar()).getByRole("button", { name: "Fiche" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("gives way once the Sidebar comes back beside it", async () => {
    screenOf(80);
    document.documentElement.dataset.sidebar = "closed";
    renderInFrench(<SectionPage />);
    await screen.findByText("Mardi 4 novembre, 10 h");
    expect(shownFiche()).not.toBeNull();

    document.documentElement.dataset.sidebar = "open";

    await vi.waitFor(() => expect(shownFiche()).toBeNull());
    expect(within(topBar()).getByRole("button", { name: "Fiche" }).getAttribute("aria-expanded")).toBe("false");
  });
});
