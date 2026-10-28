// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { ConfirmDialog } from "./Dialog";
import { renderInFrench } from "./testing";

function DeleteProfile({ onConfirm }: { onConfirm: () => void }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="danger">Supprimer le profil…</Button>}
      title="Supprimer le profil « Head of BU » ?"
      confirmLabel="Supprimer"
      tone="danger"
      onConfirm={onConfirm}
    >
      Ses recherches et ses offres sont supprimées avec lui.
    </ConfirmDialog>
  );
}

describe("ConfirmDialog (#462)", () => {
  it("asks for a confirmation as an alert dialog, the focus on Annuler, the safe choice", async () => {
    const user = userEvent.setup();
    renderInFrench(<DeleteProfile onConfirm={() => {}} />);
    await user.tab();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("alertdialog", { name: "Supprimer le profil « Head of BU » ?" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe("Ses recherches et ses offres sont supprimées avec lui.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Annuler" }));
  });

  it("closes on Escape or Annuler without confirming, the focus back on its trigger", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderInFrench(<DeleteProfile onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Supprimer le profil…" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms from its confirming button, then closes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderInFrench(<DeleteProfile onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Supprimer le profil…" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Supprimer" }));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
