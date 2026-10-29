import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dangerSolid";
export type ButtonSize = "md" | "sm";

/**
 * The class names of a Button, for a link or a Radix trigger drawn as one (`<Link className={buttonClass(…)}>`), or a
 * server form's submit button. Kept out of Button.tsx (a client module), so a server page can call it.
 * `variant`: primary (the page's one main action), secondary (the default), quiet (text in the accent), danger (a
 * destructive action, outlined) or dangerSolid (the confirming button of a destructive Dialog).
 */
export function buttonClass({ variant = "secondary", size = "md" }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return ["ds-button", `ds-button--${variant}`, size === "sm" ? "ds-button--sm" : ""].filter(Boolean).join(" ");
}
