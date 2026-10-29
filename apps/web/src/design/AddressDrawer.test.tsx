// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AddressDrawer, useLeaveAddressDrawer } from "./AddressDrawer";
import { renderInFrench } from "./testing";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const CLOSED = "/admin/parametres?tab=recherche-web";

/** Paramètres with Perplexity's sheet open, as the server draws it from `&fournisseur=perplexity` (#465). */
function Parametres() {
  return (
    <>
      <a href={`${CLOSED}&fournisseur=perplexity`} data-opens-sheet="perplexity">
        Perplexity
      </a>
      <a href="/admin/parametres?tab=ia">IA</a>
      <AddressDrawer title="Perplexity" closeHref={CLOSED} opener='[data-opens-sheet="perplexity"]' data-sheet="perplexity">
        <a href="/admin/outils/perplexity">Page de l'outil</a>
        <button type="submit">Tester</button>
      </AddressDrawer>
    </>
  );
}

describe("AddressDrawer: a Drawer the address opens (#465)", () => {
  beforeEach(() => push.mockClear());

  it("is the Drawer, a dialog named by its title, open with the focus inside and kept there", async () => {
    const user = userEvent.setup();
    renderInFrench(<Parametres />);
    const drawer = screen.getByRole("dialog", { name: "Perplexity" });
    expect(drawer.getAttribute("data-sheet")).toBe("perplexity");
    expect(drawer.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape: the address without it, the focus back on the link that opened it", async () => {
    const user = userEvent.setup();
    renderInFrench(<Parametres />);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).toHaveBeenCalledWith(CLOSED, { scroll: false });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Perplexity" }));
  });

  it("closes from « Fermer » the same way", async () => {
    const user = userEvent.setup();
    renderInFrench(<Parametres />);
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).toHaveBeenCalledWith(CLOSED, { scroll: false });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Perplexity" }));
  });

  it("is left for a panel beside the page (the Back Office Assistant): closed, the focus not taken back to its opener", async () => {
    const user = userEvent.setup();
    function AskTheAssistant() {
      const leave = useLeaveAddressDrawer();
      return (
        <button type="button" onClick={() => leave?.()}>
          Pays
        </button>
      );
    }
    renderInFrench(
      <>
        <a href="?fournisseur=perplexity" data-opens-sheet="perplexity">
          Perplexity
        </a>
        <AddressDrawer title="Perplexity" closeHref={CLOSED} opener='[data-opens-sheet="perplexity"]'>
          <AskTheAssistant />
        </AddressDrawer>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Pays" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).toHaveBeenCalledWith(CLOSED, { scroll: false });
    expect(document.activeElement).not.toBe(screen.getByRole("link", { name: "Perplexity" }));
  });

  it("is in the server's HTML, open, so its forms work before the page's scripts run", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <I18nProvider locale="fr">
        <Parametres />
      </I18nProvider>,
    );
    const drawer = container.querySelector('[role="dialog"][data-sheet="perplexity"]');
    expect(drawer?.textContent).toContain("Perplexity");
    expect(drawer?.querySelector('button[type="submit"]')?.textContent).toBe("Tester");
  });
});
