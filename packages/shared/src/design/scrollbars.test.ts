import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCROLLING_CLASS, trackScrolling, type ScrollingDocument } from "./index";

/** An element with just a class list. */
function element() {
  const classes = new Set<string>();
  return { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) }, has: (c: string) => classes.has(c) };
}

/** A document whose scroll events can be fired by hand, from an element or from the page itself. */
function fakeDocument() {
  const listeners = new Set<(event: { target: unknown }) => void>();
  const page = element();
  const doc: ScrollingDocument & { scroll(target: unknown): void; listening(): number } = {
    scrollingElement: page,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    scroll: (target) => listeners.forEach((listener) => listener({ target })),
    listening: () => listeners.size,
  };
  return { doc, page };
}

describe("trackScrolling (scrollbars shown only while their area scrolls, ADR-0053)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("marks the area that scrolls, and only while it scrolls", () => {
    const { doc } = fakeDocument();
    trackScrolling(doc, { idleMs: 800 });
    const list = element();
    const other = element();

    doc.scroll(list);
    expect(list.has(SCROLLING_CLASS)).toBe(true);
    expect(other.has(SCROLLING_CLASS)).toBe(false);

    vi.advanceTimersByTime(500);
    doc.scroll(list);
    vi.advanceTimersByTime(500);
    expect(list.has(SCROLLING_CLASS)).toBe(true);

    vi.advanceTimersByTime(300);
    expect(list.has(SCROLLING_CLASS)).toBe(false);
  });

  it("marks the page's own scrolling element when the page scrolls", () => {
    const { doc, page } = fakeDocument();
    trackScrolling(doc);
    doc.scroll(doc);
    expect(page.has(SCROLLING_CLASS)).toBe(true);
  });

  it("stops listening when stopped", () => {
    const { doc } = fakeDocument();
    const stop = trackScrolling(doc);
    expect(doc.listening()).toBe(1);
    stop();
    expect(doc.listening()).toBe(0);
  });
});
