// @vitest-environment jsdom
import { article } from "@jobhub/help";
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpIntro } from "@/components/CoachHelp";
import { renderInFrench } from "@/design/testing";
import { GettingStartedProvider, type GettingStartedAccount } from "./getting-started";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ refresh: vi.fn() }) }));

// #1069: « Pour bien commencer » in an empty conversation's help, above « Souvent demandé »: a titled group of buttons,
// each opening its Help Article, moved through with ↑ and ↓ like the rest of the help. The account comes from the
// server (GettingStartedProvider); the browser decides whether the extension is offered.

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const newAccount = (more: Partial<GettingStartedAccount> = {}): GettingStartedAccount => ({
  createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  atsScore: false,
  extensionCapture: false,
  extensionPublished: true,
  ...more,
});
const ATS = article("glossary-ats-score", "fr")!;
const EXTENSION = article("page-install-extension", "fr")!;

function browse(userAgent: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);
}

function intro(account: GettingStartedAccount | null, onOpen = vi.fn(), more: Partial<Parameters<typeof HelpIntro>[0]> = {}) {
  renderInFrench(
    <GettingStartedProvider account={account}>
      <HelpIntro pathname="/compte" locale="fr" onOpen={onOpen} {...more} />
    </GettingStartedProvider>,
  );
  return onOpen;
}

const group = () => screen.getByRole("group", { name: "Pour bien commencer" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("« Pour bien commencer » in an empty conversation's help (#1069)", () => {
  it("lists, for a new account on Chrome on a computer, the ATS Score then the extension, above « Souvent demandé »", () => {
    browse(CHROME);
    const onOpen = intro(newAccount());
    const buttons = within(group()).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["L'ATS Score de mon CV", "Garder une offre vue sur un autre site"]);
    expect(within(group()).getByRole("heading", { name: "Pour bien commencer" })).toBeTruthy();
    // Above « Souvent demandé ».
    const often = screen.getByRole("heading", { name: "Souvent demandé" });
    expect(group().compareDocumentPosition(often) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(buttons[1]!);
    expect(onOpen).toHaveBeenCalledWith(EXTENSION);
  });

  it("moves with ↓ and ↑ from one to the next, like the rest of the help", () => {
    browse(CHROME);
    const onOpen = intro(newAccount());
    const [ats, extension] = within(group()).getAllByRole("button");
    ats!.focus();
    fireEvent.keyDown(ats!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(extension);
    fireEvent.keyDown(extension!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(extension);
    fireEvent.keyDown(extension!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(ats);
    fireEvent.click(ats!);
    expect(onOpen).toHaveBeenCalledWith(ATS);
    // Inside the help (`data-help`): Escape there brings the Candidate back to the message box.
    expect(group().closest("[data-help]")).not.toBeNull();
  });

  it("is shown even on a page with suggestions of its own, where « Souvent demandé » is not", () => {
    browse(CHROME);
    intro(newAccount(), vi.fn(), { oftenAsked: false });
    expect(within(group()).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "Souvent demandé" })).toBeNull();
  });

  it("leaves out the extension outside Chrome, and what the account has already used", () => {
    browse(FIREFOX);
    intro(newAccount());
    expect(within(group()).getAllByRole("button").map((button) => button.textContent)).toEqual(["L'ATS Score de mon CV"]);
  });

  it("is not shown once nothing is left to show", () => {
    browse(CHROME);
    intro(newAccount({ atsScore: true, extensionCapture: true }));
    expect(screen.queryByRole("group", { name: "Pour bien commencer" })).toBeNull();
  });

  it("is not shown without an account (after 14 days, the server sends none)", () => {
    browse(CHROME);
    intro(null);
    expect(screen.queryByRole("group", { name: "Pour bien commencer" })).toBeNull();
  });

  it("is not shown to an Administrator, in the Back Office Assistant", () => {
    browse(CHROME);
    intro(newAccount(), vi.fn(), { audience: "administrator" });
    expect(screen.queryByRole("group", { name: "Pour bien commencer" })).toBeNull();
  });
});
