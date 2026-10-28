import type { ReactNode } from "react";
import "./Pill.css";

export type Tone = "accent" | "success" | "warn" | "danger" | "neutral";

/** A tinted label: an Application's status, where a setting comes from, a Plan. Its words carry the meaning, not its tint. */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="ds-pill" data-tone={tone}>
      {children}
    </span>
  );
}

export type StatusTone = "success" | "warn" | "danger" | "neutral";

/** A status dot followed by its words (« Connecté », « Clé manquante »): the dot never stands alone (ADR-0009). */
export function Status({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className="ds-status" data-tone={tone}>
      <span className="ds-status__dot" aria-hidden />
      {children}
    </span>
  );
}
