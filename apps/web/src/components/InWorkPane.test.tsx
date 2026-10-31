// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { helpArticle } from "@/coach-help";
import { renderInFrench } from "@/design/testing";
import { useWorkPane } from "./work-pane";
import { InWorkPane, WorkPane, WorkPaneProvider } from "./WorkPane";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/candidatures/a1/entretiens", useRouter: () => ({ push, refresh: vi.fn() }) }));

const APPLICATION = "/candidatures/a1";
const INTERVIEWS = "/candidatures/a1/entretiens";

function OpenHelp() {
  const pane = useWorkPane();
  return (
    <button type="button" onClick={() => pane?.open({ kind: "help", article: helpArticle("glossary-match-score", "fr")! })}>
      Match Score
    </button>
  );
}

/** An Application's Section page, as the layout renders it: inside the page, shown in the Work Pane beside it. */
function SectionPage() {
  return (
    <WorkPaneProvider version="1.2.3">
      <main>
        <OpenHelp />
        <InWorkPane kind="section" title="Entretiens" href={INTERVIEWS} back={APPLICATION}>
          <p>Mardi 4 novembre, 10 h</p>
          <button type="button">Ajouter l&apos;entretien</button>
        </InWorkPane>
      </main>
      <WorkPane />
    </WorkPaneProvider>
  );
}

const pane = () => screen.getByRole("complementary");

describe("a Section or a Result at its address, in the Work Pane (#603, ADR-0070)", () => {
  beforeEach(() => push.mockReset());

  it("shows in the Work Pane, never in the page, titled, the focus on its title", () => {
    renderInFrench(<SectionPage />);

    expect(screen.getByRole("complementary", { name: "Entretiens" })).toBe(pane());
    expect(within(pane()).getByText("Mardi 4 novembre, 10 h")).toBeTruthy();
    expect(within(pane()).getByRole("button", { name: "Ajouter l'entretien" })).toBeTruthy();
    expect(within(screen.getByRole("main")).queryByText("Mardi 4 novembre, 10 h")).toBeNull();
    expect(document.activeElement).toBe(within(pane()).getByRole("heading", { level: 2, name: "Entretiens" }));
  });

  it("closes with its ✕ back to the object's address", async () => {
    const user = userEvent.setup();
    renderInFrench(<SectionPage />);

    await user.click(within(pane()).getByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(push).toHaveBeenCalledWith(APPLICATION, { scroll: false });
  });

  it("closes with Escape from inside it, back to the object's address", async () => {
    const user = userEvent.setup();
    renderInFrench(<SectionPage />);

    within(pane()).getByRole("button", { name: "Ajouter l'entretien" }).focus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("complementary")).toBeNull();
    expect(push).toHaveBeenCalledWith(APPLICATION, { scroll: false });
  });

  it("gives its place to another item, the address going back to the object's", async () => {
    const user = userEvent.setup();
    renderInFrench(<SectionPage />);

    await user.click(screen.getByRole("button", { name: "Match Score" }));

    expect(screen.getByRole("complementary", { name: "Score de correspondance" })).toBeTruthy();
    expect(screen.queryByText("Mardi 4 novembre, 10 h")).toBeNull();
    expect(push).toHaveBeenCalledWith(APPLICATION, { scroll: false });
  });
});
