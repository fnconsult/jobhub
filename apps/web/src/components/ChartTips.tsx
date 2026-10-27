"use client";

import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

interface Tip {
  lines: string[];
  /** Above the mark's centre, in the frame's pixels. */
  x: number;
  y: number;
}

const MARK = "[data-tip]";
const NEXT = ["ArrowRight", "ArrowDown"];
const PREVIOUS = ["ArrowLeft", "ArrowUp"];

/**
 * A chart's hover layer (#408): pointing at a mark carrying `data-tip` (its lines, `\n` apart: what it is, then its
 * values), or focusing it, shows them in a tooltip above it. The marks are one tab stop: the arrow keys move between
 * them, Home and End go to the first and last. Tooltips never gate: each mark is labelled with the same text
 * (`aria-label`), and every value is in the chart's table view too.
 */
export function ChartTips({ label, children }: { label: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const markOf = (target: EventTarget | null): HTMLElement | null => {
    const mark = target instanceof Element ? target.closest<HTMLElement>(MARK) : null;
    return mark && frame.current?.contains(mark) ? mark : null;
  };
  const show = (mark: HTMLElement | null) => {
    if (!mark || !frame.current) return setTip(null);
    const outer = frame.current.getBoundingClientRect();
    const box = mark.getBoundingClientRect();
    setTip({ lines: (mark.dataset.tip ?? "").split("\n"), x: box.left + box.width / 2 - outer.left, y: box.top - outer.top });
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const marks = [...(frame.current?.querySelectorAll<HTMLElement>(MARK) ?? [])];
    const at = marks.indexOf(markOf(event.target) as HTMLElement);
    if (at < 0) return;
    const to = NEXT.includes(event.key) ? at + 1 : PREVIOUS.includes(event.key) ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? marks.length - 1 : null;
    if (to === null) {
      if (event.key === "Escape") setTip(null);
      return;
    }
    event.preventDefault();
    const next = marks[Math.max(0, Math.min(marks.length - 1, to))]!;
    for (const mark of marks) mark.tabIndex = mark === next ? 0 : -1;
    next.focus();
  };

  return (
    <div
      ref={frame}
      className="chart-frame"
      role="group"
      aria-label={label}
      onPointerOver={(event: PointerEvent<HTMLDivElement>) => show(markOf(event.target))}
      onPointerLeave={() => setTip(null)}
      onFocus={(event: FocusEvent<HTMLDivElement>) => show(markOf(event.target))}
      onBlur={() => setTip(null)}
      onKeyDown={move}
    >
      {children}
      {tip ? (
        <div className="chart-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.lines.map((line, index) => (index === 0 ? <span key={index}>{line}</span> : <strong key={index}>{line}</strong>))}
        </div>
      ) : null}
    </div>
  );
}
