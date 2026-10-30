// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { ThemeChoice } from "./ThemeChoice";

/** The device prefers dark or not. */
function preferDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && dark,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe("ThemeChoice, Mon compte › Préférences (#473)", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    preferDark(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers Clair, Sombre and Système, Système chosen by default", () => {
    renderInFrench(<ThemeChoice />);
    const group = screen.getByRole("radiogroup", { name: "Thème" });
    const options = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(options.map((option) => option.textContent)).toEqual(["Clair", "Sombre", "Système"]);
    expect(screen.getByRole("radio", { name: "Système" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Mémorisé sur cet appareil. Système suit le réglage de votre appareil.")).toBeTruthy();
  });

  it("shows the choice remembered on this device", () => {
    localStorage.setItem("jobbbox.theme", "dark");
    renderInFrench(<ThemeChoice />);
    expect(screen.getByRole("radio", { name: "Sombre" }).getAttribute("aria-checked")).toBe("true");
  });

  it("draws the page in the chosen theme at once and remembers it; Système follows the device", async () => {
    preferDark(true);
    renderInFrench(<ThemeChoice />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: "Clair" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("jobbbox.theme")).toBe("light");
    expect(screen.getByRole("radio", { name: "Clair" }).getAttribute("aria-checked")).toBe("true");

    await user.click(screen.getByRole("radio", { name: "Système" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("jobbbox.theme")).toBe("system");

    await user.click(screen.getByRole("radio", { name: "Sombre" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("jobbbox.theme")).toBe("dark");
  });
});
