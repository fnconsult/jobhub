// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";
import { Drawer } from "./Drawer";
import { OverlayScope } from "./overlay";
import { renderInFrench } from "./testing";

/** A part of a page in its own theme and Density, as the Design System page shows its catalogue (#463). */
function DarkPart() {
  return (
    <OverlayScope data-theme="dark" data-density="compact" data-testid="dark-part">
      <Drawer trigger={<Button>Ouvrir la fiche</Button>} title="Perplexity">
        <p>Recherche web.</p>
      </Drawer>
      <ConfirmDialog trigger={<Button>Supprimer…</Button>} title="Supprimer le profil ?" confirmLabel="Supprimer" onConfirm={() => {}}>
        Ses recherches sont supprimées avec lui.
      </ConfirmDialog>
    </OverlayScope>
  );
}

describe("OverlayScope (#463)", () => {
  it("opens the Drawers and Dialogs inside it, so they take its theme and Density", async () => {
    const user = userEvent.setup();
    renderInFrench(<DarkPart />);
    const part = screen.getByTestId("dark-part");
    expect(part.getAttribute("data-theme")).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Ouvrir la fiche" }));
    expect(part.contains(screen.getByRole("dialog", { name: "Perplexity" }))).toBe(true);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Supprimer…" }));
    expect(part.contains(screen.getByRole("alertdialog", { name: "Supprimer le profil ?" }))).toBe(true);
  });

  it("leaves them on the page's body outside one", async () => {
    const user = userEvent.setup();
    function Plain() {
      const [open, setOpen] = useState(false);
      return (
        <div data-testid="plain">
          <Drawer open={open} onOpenChange={setOpen} trigger={<Button>Ouvrir</Button>} title="Fiche">
            <p>Texte.</p>
          </Drawer>
        </div>
      );
    }
    renderInFrench(<Plain />);
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));
    expect(screen.getByTestId("plain").contains(screen.getByRole("dialog", { name: "Fiche" }))).toBe(false);
  });
});
