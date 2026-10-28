"use client";

import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import "./Ring.css";

/**
 * A score out of 100 drawn as a ring filled to it, the number in its middle: the Match Score and the ATS Score.
 * Read as « Match Score : 82 sur 100 ». The value is rounded and kept between 0 and 100.
 */
export function Ring({ label, value }: { label: string; value: number }) {
  const { t } = useTranslation();
  const score = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span className="ds-ring" role="img" aria-label={t("designSystem.ring", { label, value: score })} style={{ "--ds-ring-value": score } as CSSProperties}>
      <span aria-hidden>{score}</span>
    </span>
  );
}
