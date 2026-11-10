// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DWELL_MS, useDwellReveal } from "./dwell-reveal";

function Action() {
  const dwell = useDwellReveal();
  return (
    <button type="button" {...dwell}>
      Envoyer au coach
    </button>
  );
}

const button = () => screen.getByRole("button", { name: "Envoyer au coach" });

describe("a compact action showing its label once the pointer rests on it (#933)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows it after the pointer has rested on it for 2 seconds, not before", () => {
    render(<Action />);
    fireEvent.pointerEnter(button(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(DWELL_MS - 100));
    expect(button().dataset.revealed).toBeUndefined();
    act(() => vi.advanceTimersByTime(100));
    expect(button().dataset.revealed).toBe("");
  });

  it("goes back to its icon when the pointer leaves", () => {
    render(<Action />);
    fireEvent.pointerEnter(button(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(DWELL_MS));
    fireEvent.pointerLeave(button(), { pointerType: "mouse" });
    expect(button().dataset.revealed).toBeUndefined();
  });

  it("shows nothing when the pointer leaves before 2 seconds", () => {
    render(<Action />);
    fireEvent.pointerEnter(button(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerLeave(button(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(DWELL_MS));
    expect(button().dataset.revealed).toBeUndefined();
  });

  it("is dismissed with Escape, wherever the focus is (WCAG 1.4.13)", () => {
    render(<Action />);
    fireEvent.pointerEnter(button(), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(DWELL_MS));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(button().dataset.revealed).toBeUndefined();
  });

  it("dismisses the keyboard label until the action is focused again", () => {
    render(<Action />);
    fireEvent.focus(button());
    expect(button().dataset.revealed).toBe("");
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(button().dataset.revealed).toBeUndefined();
    act(() => vi.advanceTimersByTime(DWELL_MS));
    expect(button().dataset.revealed).toBeUndefined();
    fireEvent.blur(button());
    fireEvent.focus(button());
    expect(button().dataset.revealed).toBe("");
  });

  it("ignores a touch, which has no hover", () => {
    render(<Action />);
    fireEvent.pointerEnter(button(), { pointerType: "touch" });
    act(() => vi.advanceTimersByTime(DWELL_MS));
    expect(button().dataset.revealed).toBeUndefined();
  });
});
