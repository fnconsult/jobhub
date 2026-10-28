"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dangerSolid";
export type ButtonSize = "md" | "sm";

/**
 * The class names of a Button, for a link or a Radix trigger drawn as one (`<Link className={buttonClass(…)}>`).
 * `variant`: primary (the page's one main action), secondary (the default), quiet (text in the accent), danger (a
 * destructive action, outlined) or dangerSolid (the confirming button of a destructive Dialog).
 */
export function buttonClass({ variant = "secondary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return ["ds-button", `ds-button--${variant}`, size === "sm" ? "ds-button--sm" : ""].filter(Boolean).join(" ");
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon from `Icons`, drawn before the label, which stays in words (ADR-0009). */
  icon?: ReactNode;
  /**
   * Its action is under way: a spinner before the label, `aria-busy`, and pressing it does nothing. It keeps the
   * focus (it is not disabled), so a keyboard user is not thrown back to the top of the page.
   */
  busy?: boolean;
  /** Extra class names, for a page that places it. */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

/** The Design System's button (ADR-0053, #462). A `type="button"` unless told otherwise, so it never submits a form by surprise. */
export function Button({ variant, size, icon, busy = false, className, type = "button", onClick, children, ...rest }: ButtonProps) {
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }
  return (
    <button
      {...rest}
      type={type}
      className={[buttonClass({ variant, size }), className].filter(Boolean).join(" ")}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest["aria-disabled"] || undefined}
      onClick={click}
    >
      {busy ? <span className="ds-spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}
