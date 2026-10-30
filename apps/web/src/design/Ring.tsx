"use client";

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import "./Ring.css";

/**
 * A score out of 100 drawn as a ring filled to it, the number in its middle: the Match Score and the ATS Score.
 * Read as « Match Score : 82 sur 100 ». The value is rounded and kept between 0 and 100. `decorative`: the score is
 * already said in words beside it (a Job Offer card's « Score de correspondance : 92 / 100 », #467), so the ring is
 * hidden from screen readers.
 */
export function Ring({ value, ...naming }: { value: number } & ({ label: string; decorative?: never } | { decorative: true; label?: never })) {
  const { t } = useTranslation();
  const score = Math.min(100, Math.max(0, Math.round(value)));
  const style = { "--ds-ring-value": score } as CSSProperties;
  if (naming.decorative)
    return (
      <span className="ds-ring" aria-hidden style={style}>
        {score}
      </span>
    );
  return (
    <span className="ds-ring" role="img" aria-label={t("designSystem.ring", { label: naming.label, value: score })} style={style}>
      <span aria-hidden>{score}</span>
    </span>
  );
}
