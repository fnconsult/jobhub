"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import "./Stepper.css";

/** Where a step stands: finished (✓), under way (a pulsing dot), or to come (an empty circle). */
export type StepStatus = "done" | "current" | "pending";

export interface Step {
  /** Its key among the steps. */
  id: string;
  title: ReactNode;
  status: StepStatus;
  /** What it read or found, under its title (« 5 sources consultées, 342 pages lues »). */
  detail?: ReactNode;
}

/**
 * Steps known in advance, in a vertical list (#1001, reused by #1003): a marker each on a hairline, ✓ on the accent once
 * done, a pulsing accent dot while under way, an empty circle to come. The step under way is `aria-current="step"`, and
 * each one's state is said in words to screen readers, never by its marker alone. The pulse stops under
 * prefers-reduced-motion. The vertical counterpart of the AI Coach's steps (`.coach-panel-steps`), which are not known
 * in advance.
 */
export function Stepper({ steps, label, className }: { steps: readonly Step[]; label?: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <ol className={["ds-stepper", className].filter(Boolean).join(" ")} aria-label={label}>
      {steps.map((step) => (
        <li key={step.id} className="ds-stepper__step" data-status={step.status} aria-current={step.status === "current" ? "step" : undefined}>
          <span className="ds-stepper__marker" aria-hidden>
            {step.status === "done" ? <Icons.done /> : step.status === "current" ? <span className="ds-stepper__pulse" /> : null}
          </span>
          <div>
            <p className="ds-stepper__title">
              {step.title}
              <span className="visually-hidden"> ({t(`designSystem.stepper.${step.status}`)})</span>
            </p>
            {step.detail ? <p className="ds-stepper__detail">{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The step under way, with its place (from 1), or null when none is. */
export function currentStep(steps: readonly Step[]): { step: Step; number: number } | null {
  const index = steps.findIndex((step) => step.status === "current");
  return index < 0 ? null : { step: steps[index]!, number: index + 1 };
}
