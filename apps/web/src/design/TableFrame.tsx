"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/** Whether `frame` is narrower than what it holds, so it scrolls sideways; measured again as either changes size. */
function useScrollsSideways(frame: RefObject<HTMLElement | null>): boolean {
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [frame]);
  return scrolls;
}

/**
 * A Table's frame (#462): a card that scrolls sideways on a screen too narrow for its table, and then is a region named
 * by `label` that Tab reaches, so the keyboard can scroll it too (#463). The one part of a Table that runs in the
 * browser, so a server page can draw a Table.
 */
export function TableFrame({ label, children }: { label: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const scrolls = useScrollsSideways(frame);
  return (
    <div ref={frame} className="ds-table-wrap" role={scrolls ? "region" : undefined} aria-label={scrolls ? label : undefined} tabIndex={scrolls ? 0 : undefined}>
      {children}
    </div>
  );
}
