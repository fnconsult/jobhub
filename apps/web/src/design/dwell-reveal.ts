import { useEffect, useRef, useState, type PointerEvent } from "react";

/** How long the pointer rests on a compact action before its label shows (#933). */
export const DWELL_MS = 2000;

/**
 * A compact action (an icon alone while the Candidate writes, #933) shows its label once the pointer has rested on it
 * for 2 seconds: `data-revealed` on it, which app.css draws as the whole action floating over the text. It goes back to
 * its icon when the pointer leaves, or on Escape wherever the focus is (WCAG 2.2, 1.4.13 Content on Hover or Focus). A
 * touch has no hover: nothing. Spread the result on the action's element.
 */
export function useDwellReveal() {
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => stop, []);
  useEffect(() => {
    if (!revealed && !focused) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        stop();
        setRevealed(false);
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [revealed, focused]);

  return {
    "data-revealed": !dismissed && (revealed || focused) ? "" : undefined,
    onFocus: () => { setFocused(true); setDismissed(false); },
    onBlur: () => { setFocused(false); setDismissed(false); },
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === "touch") return;
      stop();
      setDismissed(false);
      timer.current = window.setTimeout(() => setRevealed(true), DWELL_MS);
    },
    onPointerLeave: () => {
      stop();
      setRevealed(false);
    },
  };
}
