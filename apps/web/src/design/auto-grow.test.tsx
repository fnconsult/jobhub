// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoGrow } from "./auto-grow";

function Box({ value }: { value: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, value);
  return <textarea ref={box} value={value} readOnly aria-label="Votre message" />;
}

/** Each line of the draft is 24px, as a browser would measure its content. */
function measuredByLines() {
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLTextAreaElement) {
    return this.value.split("\n").length * 24;
  });
}

describe("the message box growing with its text (#933)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("takes the height of its text where the browser cannot (no `field-sizing: content`)", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    measuredByLines();
    const { getByRole, rerender } = render(<Box value="" />);
    const box = getByRole("textbox") as HTMLTextAreaElement;
    expect(box.style.height).toBe("24px");

    rerender(<Box value={"un\ndeux\ntrois"} />);
    expect(box.style.height).toBe("72px");

    // Sent, the draft is empty: back to one line.
    rerender(<Box value="" />);
    expect(box.style.height).toBe("24px");
  });

  it("remeasures unchanged text when its width changes, and disconnects on unmount", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    let resize: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    let width = 400;
    vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width }) as DOMRect);
    vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(() => width === 400 ? 24 : 72);
    const { getByRole, unmount } = render(<Box value="The same draft wraps after the pane narrows" />);
    const box = getByRole("textbox") as HTMLTextAreaElement;
    expect(box.style.height).toBe("24px");
    width = 160;
    act(() => resize());
    expect(box.style.height).toBe("72px");
    width = 400;
    act(() => resize());
    expect(box.style.height).toBe("24px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("leaves it to CSS where the browser sizes it to its content", () => {
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "field-sizing" && value === "content" });
    measuredByLines();
    const { getByRole } = render(<Box value={"un\ndeux"} />);
    expect((getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("");
  });
});
