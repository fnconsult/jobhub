// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInFrench } from "@/design/testing";
import { EXIT_DELAY_SECONDS } from "@/external-links";
import { ExitCountdown } from "./ExitCountdown";

const URL_OUT = "https://www.example.com/offre/1";
const HOME = { href: "/compte", label: "Retour à l'accueil" };

function cameFrom(referrer: string) {
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

describe("ExitCountdown", () => {
  const replace = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("location", { ...window.location, origin: "https://jobbbox.ai", replace });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    replace.mockReset();
  });

  it("counts down from a page of Jobbbox, then takes the person to the site", async () => {
    cameFrom("https://jobbbox.ai/candidatures/1");
    renderInFrench(<ExitCountdown url={URL_OUT} site="example.com" home={HOME} />);
    expect(screen.getByRole("status").textContent).toBe(`Vous allez être redirigé vers example.com dans ${EXIT_DELAY_SECONDS} secondes.`);
    expect(screen.getByRole("link", { name: "Continuer vers example.com" }).getAttribute("href")).toBe(URL_OUT);
    expect(screen.getByRole("link", { name: "Continuer vers example.com" }).getAttribute("rel")).toContain("noreferrer");
    for (let second = 0; second < EXIT_DELAY_SECONDS; second++) await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(replace).toHaveBeenCalledWith(URL_OUT);
  });

  it("stops on « Annuler » and stays", async () => {
    cameFrom("https://jobbbox.ai/candidatures/1");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInFrench(<ExitCountdown url={URL_OUT} site="example.com" home={HOME} />);
    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.getByRole("status").textContent).toBe("Redirection annulée.");
    await act(() => vi.advanceTimersByTimeAsync((EXIT_DELAY_SECONDS + 1) * 1000));
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Retour à l'accueil" }).getAttribute("href")).toBe("/compte");
  });

  it("waits for a click when reached from outside Jobbbox", async () => {
    cameFrom("https://evil.example/");
    renderInFrench(<ExitCountdown url={URL_OUT} site="example.com" home={HOME} />);
    expect(screen.getByRole("status").textContent).toBe("Vérifiez l'adresse avant de continuer.");
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync((EXIT_DELAY_SECONDS + 1) * 1000));
    expect(replace).not.toHaveBeenCalled();
  });
});
