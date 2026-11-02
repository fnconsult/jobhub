"use client";

import { MICRO_ANIMATIONS, type MicroAnimationId } from "@jobhub/help/micro-animations";
import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MICRO_ANIMATION_ART } from "./micro-animation-art";
import "./MicroAnimation.css";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the reader asks for reduced motion, as the browser says now. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

type Shown = { run: number; state: "playing" | "played" | "still" };

/**
 * « Voir comment » (ADR-0066, #569): beside a Tutorial's step or in an empty state, a link-like button that plays a
 * Micro-animation of 2 to 5 s once, then offers « Revoir ». Nothing plays before the click (no tour, ADR-0035).
 *
 *   <MicroAnimation id="text-size" />
 *
 * The drawing is `aria-hidden`: the written step beside it stays the content. Under `prefers-reduced-motion: reduce`
 * the click shows a still image of the final state (the stylesheet holds every element there), and « Masquer » hides it.
 */
export function MicroAnimation({ id }: { id: MicroAnimationId }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<Shown | null>(null);
  const { durationMs } = MICRO_ANIMATIONS[id];
  const Art = MICRO_ANIMATION_ART[id];

  useEffect(() => {
    if (shown?.state !== "playing") return;
    const played = window.setTimeout(() => setShown((now) => (now && now.run === shown.run ? { ...now, state: "played" } : now)), durationMs);
    return () => window.clearTimeout(played);
  }, [shown, durationMs]);

  const onClick = () => {
    if (shown?.state === "playing") return;
    if (shown?.state === "still") return setShown(null);
    setShown({ run: (shown?.run ?? 0) + 1, state: prefersReducedMotion() ? "still" : "playing" });
  };

  const label = !shown || shown.state === "playing" ? t("microAnimation.show") : shown.state === "still" ? t("microAnimation.hide") : t("microAnimation.replay");
  return (
    <div className="ds-micro-animation" data-micro-animation={id} data-state={shown?.state ?? "idle"}>
      <button type="button" className="ds-micro-animation__button" aria-disabled={shown?.state === "playing" || undefined} onClick={onClick}>
        <svg className="ds-micro-animation__icon" viewBox="0 0 16 16" aria-hidden focusable={false}>
          {shown?.state === "played" ? <path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5" /> : <path d="M5.5 3.5v9l7-4.5z" />}
        </svg>
        {label}
      </button>
      {shown ? (
        <div key={shown.run} className="ds-micro-animation__stage" aria-hidden="true" style={{ "--micro-animation-duration": `${durationMs}ms` } as CSSProperties}>
          <Art />
        </div>
      ) : null}
    </div>
  );
}
