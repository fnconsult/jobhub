// @vitest-environment jsdom
import { MICRO_ANIMATION_IDS, MICRO_ANIMATIONS } from "@jobhub/help/micro-animations";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MicroAnimation } from "./MicroAnimation";
import { MICRO_ANIMATION_ART } from "./micro-animation-art";
import { renderInFrench } from "./testing";

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

const stage = (container: HTMLElement) => container.querySelector(".ds-micro-animation__stage");

describe("MicroAnimation « Voir comment » (#569)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays nothing before the click, then plays once and offers « Revoir »", () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const { container } = renderInFrench(<MicroAnimation id="text-size" />);
    expect(stage(container)).toBeNull();
    expect(container.querySelector("svg.ma-art")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Voir comment" }));
    expect(stage(container)).not.toBeNull();
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("playing");
    expect(screen.getByRole("button", { name: "Voir comment" }).getAttribute("aria-disabled")).toBe("true");

    act(() => void vi.advanceTimersByTime(MICRO_ANIMATIONS["text-size"].durationMs));
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("played");
    const replay = screen.getByRole("button", { name: "Revoir" });

    const played = stage(container);
    fireEvent.click(replay);
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("playing");
    expect(stage(container)).not.toBe(played); // a new drawing: its movement starts over
  });

  it("keeps the drawing out of the accessibility tree", () => {
    reducedMotion(false);
    const { container } = renderInFrench(<MicroAnimation id="forward-email" />);
    fireEvent.click(screen.getByRole("button", { name: "Voir comment" }));
    expect(stage(container)!.getAttribute("aria-hidden")).toBe("true");
    expect(stage(container)!.querySelector("svg")!.getAttribute("focusable")).toBe("false");
    expect(screen.getAllByRole("button")).toHaveLength(1); // nothing in the drawing to reach
  });

  it("under reduced motion shows the still image of the final state, and « Masquer » hides it", () => {
    reducedMotion(true);
    const { container } = renderInFrench(<MicroAnimation id="interview-status" />);
    fireEvent.click(screen.getByRole("button", { name: "Voir comment" }));
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("still");
    expect(stage(container)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Masquer" }));
    expect(stage(container)).toBeNull();
  });

  it("has a drawing for every Micro-animation, each played for 2 to 5 s", () => {
    expect(Object.keys(MICRO_ANIMATION_ART).sort()).toEqual([...MICRO_ANIMATION_IDS].sort());
    for (const id of MICRO_ANIMATION_IDS) expect(MICRO_ANIMATIONS[id].durationMs).toBeGreaterThanOrEqual(2000);
    for (const id of MICRO_ANIMATION_IDS) expect(MICRO_ANIMATIONS[id].durationMs).toBeLessThanOrEqual(5000);
  });
});
