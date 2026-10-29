// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSettings } from "@/components/AccountSettings";
import { I18nProvider } from "@/i18n/I18nProvider";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { renderInFrench } from "./testing";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

/** The HTML the server sends: what a person (or a test) can use before the page's scripts have run. */
function serverHtml(ui: ReactNode): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<I18nProvider locale="fr">{ui}</I18nProvider>);
  return container;
}

const drawer = (
  <Drawer trigger={<Button>Ouvrir la fiche</Button>} title="Perplexity">
    <p>Clé</p>
  </Drawer>
);
const confirm = (
  <ConfirmDialog trigger={<Button>Supprimer</Button>} title="Supprimer ?" confirmLabel="Supprimer" onConfirm={() => {}}>
    <p>Définitivement.</p>
  </ConfirmDialog>
);

// A control used before the page is hydrated does nothing: no handler is attached yet, and the choice or the click is
// lost (#446: the Interface Language picked too early stayed French; a Drawer's trigger clicked too early never opened).
// So each one is disabled until it can act, and Playwright, like a person, waits for it to be enabled.
describe("controls that only act once the page is hydrated", () => {
  it("the Interface Language is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(<AccountSettings interfaceLanguage="fr" />).querySelector("select")!.disabled).toBe(true);
    renderInFrench(<AccountSettings interfaceLanguage="fr" />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
  });

  it("a Drawer's trigger is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(drawer).querySelector("button")!.disabled).toBe(true);
    renderInFrench(drawer);
    expect((screen.getByRole("button", { name: "Ouvrir la fiche" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a ConfirmDialog's trigger is disabled in the server's HTML, then enabled", () => {
    expect(serverHtml(confirm).querySelector("button")!.disabled).toBe(true);
    renderInFrench(confirm);
    expect((screen.getByRole("button", { name: "Supprimer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a trigger disabled by its owner stays disabled once hydrated", () => {
    renderInFrench(
      <Drawer trigger={<Button disabled>Ouvrir la fiche</Button>} title="Perplexity">
        <p>Clé</p>
      </Drawer>,
    );
    expect((screen.getByRole("button", { name: "Ouvrir la fiche" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
