import type { ReactNode } from "react";
import "./Pill.css";

export type Tone = "accent" | "success" | "warn" | "danger" | "neutral";

export type PillSize = "md" | "sm";

/**
 * A tinted label: an Application's status, where a setting comes from, a Plan. Its words carry the meaning, not its tint.
 * `size="sm"`, at the metadata size (ADR-0009, amendment of 2026-11-12), for a label inside a line of metadata only (the
 * Provenance line's « hors UE »): a status the person reads stays at body size.
 */
export function Pill({ tone = "neutral", size = "md", children }: { tone?: Tone; size?: PillSize; children: ReactNode }) {
  return (
    <span className="ds-pill" data-tone={tone} data-size={size === "sm" ? "sm" : undefined}>
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
