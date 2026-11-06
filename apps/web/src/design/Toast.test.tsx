// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { TOAST_DURATION_MS, ToastProvider, useToast } from "./Toast";
import { renderInFrench } from "./testing";

function Save() {
  const toast = useToast();
  return <Button onClick={() => toast({ message: "Offre enregistrée en candidature.", link: { label: "Voir la candidature", href: "/candidatures/1" } })}>Enregistrer</Button>;
}

describe("Toast (#462)", () => {
  afterEach(() => vi.useRealTimers());

  it("says its message in a polite live region, at the bottom of the page, with its link", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <ToastProvider>
        <Save />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(region.textContent).toContain("Offre enregistrée en candidature.");
    expect(screen.getByRole("link", { name: "Voir la candidature" }).getAttribute("href")).toBe("/candidatures/1");
  });

  it("goes away on Escape while its link has the focus, the focus back where it was", async () => {
    const user = userEvent.setup();
    renderInFrench(
      <ToastProvider>
        <Save />
      </ToastProvider>,
    );
    const save = screen.getByRole("button", { name: "Enregistrer" });
    await user.click(save);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Voir la candidature" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("link", { name: "Voir la candidature" })).toBeNull();
    expect(document.activeElement).toBe(save);
  });

  it("goes away on its own after a while, but not while it holds the focus", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInFrench(
      <ToastProvider>
        <Save />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await user.tab();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS * 2));
    expect(screen.getByRole("link", { name: "Voir la candidature" })).toBeTruthy();
    await user.tab({ shift: true });
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS + 1));
    expect(screen.queryByRole("link", { name: "Voir la candidature" })).toBeNull();
  });

  it("may hold an action instead of a link (« Annuler »): pressing it runs it and closes the Toast (#816)", async () => {
    const user = userEvent.setup();
    const undo = vi.fn();
    function Dismiss() {
      const toast = useToast();
      return <Button onClick={() => toast({ message: "« DAF » écartée.", action: { label: "Annuler", onAction: undo } })}>Écarter</Button>;
    }
    renderInFrench(
      <ToastProvider>
        <Dismiss />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Écarter" }));
    expect(screen.getByRole("status").textContent).toContain("« DAF » écartée.");
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });
});
