import { useLayoutEffect, type RefObject } from "react";

/** Whether the browser sizes a text area to its content itself (`field-sizing: content`: Chromium; not yet Firefox, Safari). */
const sizesToContent = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/**
 * The message box grows with its text (#933): where the browser has no `field-sizing: content`, its height follows its
 * text's, measured after each change, and comes back to one line once the draft is emptied (sent). Its CSS caps it (about
 * 8 lines, then it scrolls inside) and sets `box-sizing: border-box`, so the height measured is the height set.
 */
export function useAutoGrow(box: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || sizesToContent()) return;
    const measure = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    void value;
    measure();
    let width = element.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth === width) return;
      width = nextWidth;
      measure();
    });
    observer?.observe(element);
    return () => observer?.disconnect();
    // Also reconnect when a conditionally rendered composer mounts with the same draft.
  });
}
