import { useLayoutEffect, type RefObject } from "react";

/** Whether the browser sizes a text area to its content itself (`field-sizing: content`: Chromium; not yet Firefox, Safari). */
const sizesToContent = () => typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/**
 * The message box grows with its text (#933): where the browser has no `field-sizing: content`, its height follows its
 * text's, measured after each change, and comes back to one line once the draft is emptied (sent). Its CSS caps it (about
 * 8 lines, then it scrolls inside) and sets `box-sizing: border-box`, so the height measured is the height set.
 *
 * Once the text runs past one line (a new line, or a line that wraps, the box taller than its `min-height`), the box says
 * so with `data-multiline`, for app.css to give the text the box's whole width; it says so until the draft is emptied, so
 * the layout never flips back and forth as the text narrows and widens.
 */
export function useAutoGrow(box: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    if (!sizesToContent()) {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    }
    if (value === "") delete element.dataset.multiline;
    else if (element.dataset.multiline === undefined && (value.includes("\n") || pastOneLine(element))) element.dataset.multiline = "";
  }, [box, value]);
}

/** Whether the box is taller than its one line (its `min-height`): its text wraps. */
function pastOneLine(element: HTMLTextAreaElement) {
  const oneLine = parseFloat(getComputedStyle(element).minHeight);
  return Number.isFinite(oneLine) && oneLine > 0 && element.offsetHeight > oneLine + 1;
}
