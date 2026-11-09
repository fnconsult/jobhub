// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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

  it("leaves it to CSS where the browser sizes it to its content", () => {
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "field-sizing" && value === "content" });
    measuredByLines();
    const { getByRole } = render(<Box value={"un\ndeux"} />);
    expect((getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("");
  });
});
