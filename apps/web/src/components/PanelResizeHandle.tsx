"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import {
  clampPanelWidth,
  panelMaxWidth,
  panelWidthFromKey,
  readPanelWidth,
  setPanelWidthProperty,
  writePanelWidth,
  type PanelWidthSpec,
} from "@/design/panel-width";

const noSubscription = () => () => {};
const noStoredWidth = () => null;
/** A press that moves less than this is a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** How long a click waits for a second one, which would make it a double-click. */
const DOUBLE_CLICK_MS = 300;
/** The columns beside the conversation, children of the workspace: each leaves room for the other. */
const COLUMNS = ":scope > :is(.work-pane, .fiche)";

/** The root font size in px, which the Text Size changes: the limits are in rem. */
const rootRem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** Wide enough for the columns beside the conversation: below 64rem they take the whole screen, with no handle. */
const BESIDE = "(width >= 64rem)";
function onBesideChange(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(BESIDE) : null;
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
const besideNow = () => typeof window.matchMedia !== "function" || window.matchMedia(BESIDE).matches;
const besideOnServer = () => true;

/** Whether the columns stand beside the conversation (64rem and wider), where they have a resize handle. */
export const useColumnsBeside = () => useSyncExternalStore(onBesideChange, besideNow, besideOnServer);

type Bounds = { min: number; max: number; initial: number };

/**
 * The handle on the left edge of a column beside the conversation (#932): the side panel's (« Fiche », « Documents »…)
 * and the Work Pane's, where Sections, Results and Job Offers open. Dragged, it widens the column from its narrowest up
 * to the widest it may be (panel-width.ts), which it sets on the column as `spec.maxProperty` for app.css. A window
 * splitter (WAI-ARIA): focusable, named by `label`, ← and → by steps, Home and End to its limits. A click without
 * dragging takes it to its widest, or back to its narrowest from there, so a single pointer resizes it without dragging
 * (WCAG 2.2, 2.5.7); a double-click goes back to the default width and forgets the one remembered. The width is
 * remembered in this browser, and the head's script set it on <html> before first paint; read here once hydrated, so
 * the server's HTML and the first render agree. Drawn as the column's first child, only beside the conversation (on a
 * phone the column takes the whole screen).
 */
export function PanelResizeHandle({ spec, label }: { spec: PanelWidthSpec; label: string }) {
  const handle = useRef<HTMLDivElement>(null);
  // What this browser remembers, once hydrated (null on the server), until the Candidate moves the handle.
  const stored = useSyncExternalStore(noSubscription, () => readPanelWidth(spec), noStoredWidth);
  const [moved, setChosen] = useState<number | null | undefined>(undefined);
  const chosen = moved === undefined ? stored : moved;
  const [bounds, setBounds] = useState<Bounds>(() => {
    const min = spec.minRem * 16;
    return { min, max: min, initial: min };
  });
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const clickTimer = useRef<number | undefined>(undefined);
  const now = clampPanelWidth(chosen ?? bounds.initial, bounds);

  // Measures the room there is: the window, the conversation and its columns, the other column while it is open.
  useLayoutEffect(() => {
    const column = handle.current?.parentElement;
    const workspace = column?.parentElement;
    if (!column || !workspace) return;
    const measure = () => {
      const rem = rootRem();
      const viewport = window.innerWidth;
      const other = [...workspace.querySelectorAll<HTMLElement>(COLUMNS)].filter((el) => el !== column).reduce((sum, el) => sum + (el.offsetWidth ?? 0), 0);
      const max = panelMaxWidth(spec, { viewport, workspace: workspace.clientWidth, other, rem });
      const min = spec.minRem * rem;
      const initial = spec.defaultWidth({ viewport, workspace: workspace.clientWidth, rem });
      column.style.setProperty(spec.maxProperty, `${max}px`);
      setBounds((was) => (was.min === min && was.max === max && was.initial === initial ? was : { min, max, initial }));
    };
    measure();
    window.addEventListener("resize", measure);
    // The Sidebar hidden or shown, or the other column opened, closed or resized, changes the room without resizing the
    // window.
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    const observeColumns = () => {
      sizes?.disconnect();
      sizes?.observe(workspace);
      for (const el of workspace.querySelectorAll<HTMLElement>(COLUMNS)) if (el !== column) sizes?.observe(el);
    };
    observeColumns();
    const children = typeof MutationObserver === "function" ? new MutationObserver(() => (observeColumns(), measure())) : null;
    children?.observe(workspace, { childList: true });
    return () => {
      window.removeEventListener("resize", measure);
      sizes?.disconnect();
      children?.disconnect();
    };
  }, [spec]);

  const choose = useCallback(
    (width: number, remember: boolean) => {
      setChosen(width);
      setPanelWidthProperty(spec, width);
      if (remember) writePanelWidth(spec, width);
    },
    [spec],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const width = panelWidthFromKey(event.key, now, bounds, rootRem());
    if (width === null) return;
    event.preventDefault();
    // A column's Escape closes it: the handle's keys stay the handle's.
    event.stopPropagation();
    choose(width, true);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, width: now, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const by = drag.current.x - event.clientX;
    if (!drag.current.moved && Math.abs(by) < CLICK_SLOP_PX) return;
    drag.current.moved = true;
    // The handle is on the column's left edge: to the left, wider.
    choose(clampPanelWidth(drag.current.width + by, bounds), false);
  };
  const onPointerEnd = () => {
    if (!drag.current) return;
    dragged.current = drag.current.moved;
    drag.current = null;
    if (dragged.current) writePanelWidth(spec, now);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    // The click that ends a drag is the drag's.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (clickTimer.current !== undefined) window.clearTimeout(clickTimer.current);
    clickTimer.current = undefined;
    if (event.detail === 2) {
      // A double-click: the default width again, the one remembered forgotten.
      setChosen(null);
      setPanelWidthProperty(spec, null);
      writePanelWidth(spec, null);
    } else if (event.detail <= 1) {
      // A click, the single-pointer way to resize it (WCAG 2.2, 2.5.7): to its widest, or back to its narrowest. Once it
      // is clear it is not a double-click's first: resized at once, the handle would move from under the second click.
      const to = now < bounds.max ? bounds.max : bounds.min;
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = undefined;
        choose(to, true);
      }, DOUBLE_CLICK_MS);
    }
  };
  useEffect(() => () => window.clearTimeout(clickTimer.current), []);

  return (
    <div
      ref={handle}
      className="panel-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={now}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
    />
  );
}
