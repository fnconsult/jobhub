// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Icons } from "@/components/icons";
import { Button } from "./Button";
import { renderInFrench } from "./testing";

describe("Button (#462)", () => {
  it("is pressed with Enter and Space once focused with Tab", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderInFrench(<Button onClick={onClick}>Lire l&apos;offre</Button>);
    await user.tab();
    expect(screen.getByRole("button", { name: "Lire l'offre" })).toHaveProperty("type", "button");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Lire l'offre" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("keeps its label in words beside its icon, the icon hidden from screen readers", () => {
    renderInFrench(
      <Button variant="primary" icon={<Icons.add />}>
        Enregistrer en candidature
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Enregistrer en candidature" });
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is skipped by Tab when disabled", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <>
        <Button disabled>Désactivé</Button>
        <Button>Suivant</Button>
      </>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Suivant" }));
  });

  it("while busy, keeps the focus, says it is busy and does nothing when pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderInFrench(
      <Button busy onClick={onClick}>
        Recherche en cours…
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Recherche en cours…" });
    await user.tab();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
