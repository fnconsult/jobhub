// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Drawer, DrawerTitle } from "./Drawer";
import { TextInput } from "./Field";
import { renderInFrench } from "./testing";

function ProviderSheet() {
  return (
    <Drawer
      trigger={<Button>Ouvrir la fiche</Button>}
      title="Perplexity"
      footer={<Button variant="primary">Rendre actif</Button>}
    >
      <TextInput aria-label="Clé" defaultValue="••••a91f" />
    </Drawer>
  );
}

describe("Drawer (#462)", () => {
  it("opens from its trigger as a dialog named by its title, the focus inside it", async () => {
    const user = userEvent.setup();
    renderInFrench(<ProviderSheet />);
    await user.tab();
    await user.keyboard("{Enter}");
    const drawer = screen.getByRole("dialog", { name: "Perplexity" });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("button", { name: "Rendre actif" })).toBeTruthy();
  });

  it("closes on Escape, the focus back on its trigger", async () => {
    const user = userEvent.setup();
    renderInFrench(<ProviderSheet />);
    await user.click(screen.getByRole("button", { name: "Ouvrir la fiche" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ouvrir la fiche" }));
  });

  it("closes from its Fermer button, and keeps Tab inside while open", async () => {
    const user = userEvent.setup();
    renderInFrench(<ProviderSheet />);
    await user.click(screen.getByRole("button", { name: "Ouvrir la fiche" }));
    const drawer = screen.getByRole("dialog", { name: "Perplexity" });
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets its content draw its own head, with a DrawerTitle, opened and closed by its owner", async () => {
    const user = userEvent.setup();
    function Menu() {
      const [open, setOpen] = useState(true);
      return (
        <Drawer open={open} onOpenChange={setOpen} side="left">
          <DrawerTitle>Menu</DrawerTitle>
          <button type="button" onClick={() => setOpen(false)}>
            Fermer le menu
          </button>
        </Drawer>
      );
    }
    renderInFrench(<Menu />);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fermer" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Fermer le menu" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
