"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-class";

export { buttonClass, type ButtonSize, type ButtonVariant };

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
