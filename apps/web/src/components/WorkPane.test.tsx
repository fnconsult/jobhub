// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { helpArticle } from "@/coach-help";
import { renderInFrench } from "@/design/testing";
import { useWorkPane, type WorkPaneItem } from "./work-pane";
import { WorkPane, WorkPaneProvider } from "./WorkPane";

vi.mock("next/navigation", () => ({ usePathname: () => "/compte", useRouter: () => ({ refresh: vi.fn() }) }));

const ACCOUNT = helpArticle("page-account", "fr")!;
const MATCH_SCORE = helpArticle("glossary-match-score", "fr")!;

/** A button of the page that opens `item` in the Work Pane. */
function Opener({ item, children }: { item: WorkPaneItem; children: string }) {
  const pane = useWorkPane();
  return (
    <button type="button" onClick={() => pane?.open(item)}>
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
