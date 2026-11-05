// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpArticle } from "@/coach-help";
import { renderInFrench } from "@/design/testing";
import { MY_SIGNALEMENTS_TITLE_ID } from "./Signalement";
import { SIGNALEMENT_GLYPHS } from "./signalement-glyphs";
import { useWorkPane, type WorkPaneItem } from "./work-pane";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

/** The page's address: Mon compte, or its « Mes signalements » Section. */
let pathname = "/compte";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ refresh: vi.fn() }) }));

const ACCOUNT = helpArticle("page-account", "fr")!;
const MATCH_SCORE = helpArticle("glossary-match-score", "fr")!;

/** A button of the page that opens `item` in the Work Pane. */
function Opener({ item, focus, children }: { item: WorkPaneItem; focus?: boolean; children: string }) {
  const pane = useWorkPane();
  return (
    <button type="button" onClick={() => pane?.open(item, focus === undefined ? undefined : { focus })}>
      {children}
    </button>
  );
}

function Page() {
  return (
    <WorkPaneProvider version="1.2.3">
      <main>
        <Opener item={{ kind: "help", article: ACCOUNT }}>Aide</Opener>
        <Opener item={{ kind: "help", article: MATCH_SCORE }}>Match Score</Opener>
        <Opener item={{ kind: "help", article: ACCOUNT }} focus={false}>
          Aide sans focus
        </Opener>
      </main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const pane = () => screen.getByRole("complementary");

describe("the Work Pane (#602, ADR-0070)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens a Help Article beside the page, its title taking the focus, « Demander au coach » in its header", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    expect(screen.queryByRole("complementary")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Aide" }));

    expect(pane().getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Mon compte" })).toBe(pane());
    const title = within(pane()).getByRole("heading", { level: 2, name: "Mon compte" });
    expect(document.activeElement).toBe(title);
    expect(within(pane()).getByText(/Mon compte rassemble vos réglages/)).toBeTruthy();
    expect(within(pane()).getByText("Aide · écrit par l'équipe Jobbbox")).toBeTruthy();
    expect(within(pane()).getByRole("link", { name: "Demander au coach" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with its ✕, the focus back on what opened it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const opener = screen.getByRole("button", { name: "Aide" });
    await user.click(opener);

    await user.click(within(pane()).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes with Escape, the focus back on what opened it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const opener = screen.getByRole("button", { name: "Match Score" });
    await user.click(opener);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("opened with `focus: false` (#775), leaves the focus where it is; its ✕ still gives it back to what opened it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    const opener = screen.getByRole("button", { name: "Aide sans focus" });

    await user.click(opener);

    expect(within(pane()).getByRole("heading", { level: 2, name: "Mon compte" })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    await user.click(within(pane()).getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    // The ✕ had the focus, inside the pane: it goes back to what opened it.
    expect(document.activeElement).toBe(opener);
  });

  it("shows one item at a time: another one takes its place, and the focus", async () => {
    const user = userEvent.setup();
    renderInFrench(<Page />);
    await user.click(screen.getByRole("button", { name: "Aide" }));
    await user.click(screen.getByRole("button", { name: "Match Score" }));

    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(document.activeElement).toBe(within(pane()).getByRole("heading", { level: 2, name: MATCH_SCORE.title }));
    expect(within(pane()).queryByText(/Mon compte rassemble vos réglages/)).toBeNull();
  });
});

describe("a Signalement in the Work Pane (#602, ADR-0057 amended by ADR-0070)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function SignalementPage() {
    return (
      <WorkPaneProvider version="1.2.3">
        <main>
          <Opener item={{ kind: "signalement", start: { kind: "type", type: "idee" } }}>Proposer une idée</Opener>
          <Opener item={{ kind: "signalement", start: { kind: "question", question: "Comment exporter ?", coachReply: "Je ne sais pas." } }}>
            Poser la question à l'équipe
          </Opener>
        </main>
        <WorkPane />
      </WorkPaneProvider>
    );
  }

  it("opens a Bug or an Idée's form there, not in a Drawer, and sends it", async () => {
    const fetch = vi.fn(async () => Response.json({ signalement: { id: "s1" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    renderInFrench(<SignalementPage />);

    await user.click(screen.getByRole("button", { name: "Proposer une idée" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(within(pane()).getByRole("heading", { level: 2, name: "Envoyer un signalement" }));
    expect(within(pane()).getByRole("radio", { name: "Idée" }).getAttribute("aria-checked")).toBe("true");
    await user.type(within(pane()).getByRole("textbox"), "Un mode hors ligne serait utile.");
    await user.click(within(pane()).getByRole("button", { name: "Envoyer" }));

    expect(fetch).toHaveBeenCalledWith("/api/signalements", expect.objectContaining({ method: "POST" }));
    expect(await within(pane()).findByText("Merci, c'est envoyé.")).toBeTruthy();
  });

  it("opens « Poser la question à l'équipe » there, titled so, the question prefilled", async () => {
    const user = userEvent.setup();
    renderInFrench(<SignalementPage />);
    const opener = screen.getByRole("button", { name: "Poser la question à l'équipe" });

    await user.click(opener);

    const title = within(pane()).getByRole("heading", { level: 2, name: "Poser la question à l'équipe" });
    // ⓘ in its title (ADR-0009), decorative beside the words.
    expect(title.querySelector(".signalement-title svg[aria-hidden] path")?.getAttribute("d")).toBe(SIGNALEMENT_GLYPHS.info);
    expect((within(pane()).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Comment exporter ?");
    await user.click(within(pane()).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("titles a Bug or an Idée with its glyph, which follows the type chosen (ADR-0009)", async () => {
    const user = userEvent.setup();
    renderInFrench(<SignalementPage />);

    await user.click(screen.getByRole("button", { name: "Proposer une idée" }));

    const glyph = () => within(pane()).getByRole("heading", { level: 2, name: "Envoyer un signalement" }).querySelector(".signalement-title svg[aria-hidden] path");
    expect(glyph()?.getAttribute("d")).toBe(SIGNALEMENT_GLYPHS.shapes);
    await user.click(within(pane()).getByRole("radio", { name: "Bug" }));
    expect(glyph()?.getAttribute("d")).toBe(SIGNALEMENT_GLYPHS.bug);
  });

  it("sent from « Mes signalements », « Voir mes signalements » closes it, the focus on the Section's title, which lists it", async () => {
    pathname = "/compte/signalements";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ signalement: { id: "s1" } }, { status: 201 })));
    const user = userEvent.setup();
    renderInFrench(
      <WorkPaneProvider version="1.2.3">
        <main>
          <h2 id={MY_SIGNALEMENTS_TITLE_ID} tabIndex={-1}>
            Mes signalements
          </h2>
          <Opener item={{ kind: "signalement", start: { kind: "type", type: "idee" } }}>Proposer une idée</Opener>
        </main>
        <WorkPane />
      </WorkPaneProvider>,
    );

    try {
      await user.click(screen.getByRole("button", { name: "Proposer une idée" }));
      await user.type(within(pane()).getByRole("textbox"), "Pouvoir trier par date de relance.");
      await user.click(within(pane()).getByRole("button", { name: "Envoyer" }));
      await user.click(await within(pane()).findByRole("link", { name: "Voir mes signalements" }));

      expect(screen.queryByRole("complementary")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Mes signalements" }));
    } finally {
      pathname = "/compte";
    }
  });
});
