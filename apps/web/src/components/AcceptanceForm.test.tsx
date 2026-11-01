// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { I18nProvider } from "@/i18n/I18nProvider";
import { AcceptanceForm } from "./AcceptanceForm";

const CGU = { version: "2026-12-01", url: "/legal/cgu/2026-12-01" };

describe("AcceptanceForm, the Acceptance screen after sign-in (ADR-0062, #510)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the box unticked, naming the version and leading to it, and accepts nothing until it is ticked", () => {
    renderInFrench(<AcceptanceForm cgu={CGU} locale="fr" back="/candidatures" />);

    const box = screen.getByRole("checkbox", { name: "J'accepte les CGU (version du 01/12/2026)" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("link", { name: "Lire les CGU (version du 01/12/2026)" }).getAttribute("href")).toBe("/legal/cgu/2026-12-01");
    expect((screen.getByRole("button", { name: "Accepter et continuer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/le texte français fait foi/)).toBeNull();
  });

  it("leads to Mes données (Data export, Account deletion) and the subscription, open before accepting", () => {
    renderInFrench(<AcceptanceForm cgu={CGU} locale="fr" back="/" />);

    expect(screen.getByRole("link", { name: "Mes données" }).getAttribute("href")).toBe("/compte/donnees");
    expect(screen.getByRole("link", { name: "Abonnement" }).getAttribute("href")).toBe("/abonnement");
  });

  it("sends the version accepted, then goes back to the page asked for", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const assign = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { ...window.location, assign });
    renderInFrench(<AcceptanceForm cgu={CGU} locale="fr" back="/candidatures" />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Accepter et continuer" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/account/acceptances", expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "cgu", version: "2026-12-01", accepted: true }) }));
    expect(assign).toHaveBeenCalledWith("/candidatures");
  });

  it("reloads the screen when another version is now to accept, and says so when it fails", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload, assign: vi.fn() });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "stale" }), { status: 409 })));
    renderInFrench(<AcceptanceForm cgu={CGU} locale="fr" back="/" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Accepter et continuer" }));
    expect(reload).toHaveBeenCalled();
  });

  it("says so when the acceptance could not be saved, and lets the Candidate try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    renderInFrench(<AcceptanceForm cgu={CGU} locale="fr" back="/" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Accepter et continuer" }));

    expect(screen.getByRole("alert").textContent).toBe("Votre acceptation n'a pas pu être enregistrée. Réessayez.");
    expect((screen.getByRole("button", { name: "Accepter et continuer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("in English, says the French text prevails", () => {
    render(
      <I18nProvider locale="en">
        <AcceptanceForm cgu={CGU} locale="en" back="/" />
      </I18nProvider>,
    );

    expect(screen.getByRole("checkbox", { name: "I accept the Terms of use (version of December 1, 2026)" })).toBeTruthy();
    expect(screen.getByText("Translation: the French text prevails.")).toBeTruthy();
  });
});
