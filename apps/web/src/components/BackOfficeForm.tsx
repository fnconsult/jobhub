import type { ReactNode } from "react";

/**
 * A Back Office form, or, for an Administrator whose roles only let them read the
 * section, the same fields as a plain block: no `<form>`, so nothing can be sent.
 * The page renders its fields and buttons disabled in that case.
 */
export function BackOfficeForm({ canWrite, action, className, children }: { canWrite: boolean; action: (form: FormData) => Promise<void>; className?: string; children: ReactNode }) {
  return canWrite ? (
    <form className={className} action={action}>
      {children}
    </form>
  ) : (
    <div className={className}>{children}</div>
  );
}
