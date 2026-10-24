"use client";

import { useEffect, useRef, useState } from "react";
import type { Activity } from "@jobhub/shared";
import { ease, ENTER_MS, GLYPHS, MAX_STROKES, mix, pathOf, phaseAt, POINTS, strokesOf, type Point, type Shape } from "./activity-glyph-frames";

/**
 * The glyph of an Activity (ADR-0034, #314, #333): what a running step is doing, drawn in the line icons' style. `live`: the
 * step runs, so it moves (the brain's folds shift, the feather writes, the magnifier sweeps, the globe turns, the book turns
 * its pages, the ticks appear) and, when the next step's Activity takes its place, morphs into it, stroke by stroke, drawn
 * from JavaScript (activity-glyph-frames). Still under prefers-reduced-motion, and while not live. Decoration only, hidden
 * from screen readers: the step's label in words always sits beside it.
 */
export function ActivityGlyph({ activity, live = false }: { activity: Activity; live?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  // What it shows now, so the next Activity morphs out of it.
  const shown = useRef<Shape | null>(null);
  const moving = useMotion(live);

  useEffect(() => {
    const paths = [...(svg.current?.querySelectorAll("path") ?? [])];
    if (!moving || paths.length === 0) return;
    const frames = GLYPHS[activity].frames;
    const shapes = frames.map((frame) => shapeOf(frame.d));
    const entering = shown.current;
    const start = performance.now();
    let frame = 0;
    const draw = (shape: Shape) => {
      shown.current = shape;
      paths.forEach((path, index) => {
        const stroke = shape[index]!;
        path.setAttribute("d", pathOf(stroke.points));
        path.setAttribute("opacity", stroke.on.toFixed(2));
      });
    };
    const tick = (now: number) => {
      const elapsed = now - start;
      if (entering && elapsed < ENTER_MS) draw(mix(entering, shapes[0]!, ease(elapsed / ENTER_MS)));
      else {
        const { from, to, progress } = phaseAt(frames, elapsed - (entering ? ENTER_MS : 0));
        draw(mix(shapes[from]!, shapes[to]!, ease(progress)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activity, moving]);

  return (
    <svg ref={svg} className="activity-glyph" data-activity={activity} data-live={live || undefined} viewBox="0 0 24 24" aria-hidden focusable={false}>
      {moving
        ? // Moving, its strokes are drawn from JavaScript: React leaves their `d` alone.
          Array.from({ length: MAX_STROKES }, (_, index) => <path key={index} />)
        : GLYPHS[activity].still.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** Live, and the Candidate did not ask for less motion: it moves. Still on the server's render, and as soon as the setting changes. */
function useMotion(live: boolean): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const update = () => setAllowed(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return live && allowed;
}

const SHAPES = new Map<string, Shape>();
let probe: SVGPathElement | null = null;

/** A frame sampled into MAX_STROKES strokes of POINTS points each; padding strokes sit, collapsed and unseen, on the centre. */
function shapeOf(d: readonly string[]): Shape {
  const key = d.join("|");
  const known = SHAPES.get(key);
  if (known) return known;
  if (!probe) {
    const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:absolute;width:0;height:0;visibility:hidden";
    probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    holder.appendChild(probe);
    document.body.appendChild(holder);
  }
  const measure = probe;
  const strokes = strokesOf(d).map((stroke) => {
    measure.setAttribute("d", stroke);
    const length = measure.getTotalLength();
    const points = Array.from({ length: POINTS }, (_, index): Point => {
      const point = measure.getPointAtLength((length * index) / (POINTS - 1));
      return [point.x, point.y];
    });
    return { points, on: 1 };
  });
  while (strokes.length < MAX_STROKES) strokes.push({ points: Array.from({ length: POINTS }, (): Point => [12, 12]), on: 0 });
  const shape = strokes.slice(0, MAX_STROKES);
  SHAPES.set(key, shape);
  return shape;
}
