import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import "./ErrorView.css";

/** The codes an error page shows (#542); 503 is the proxy's own page (maintenance). */
export type ErrorCode = 404 | 403 | 500;

const ICON = { 404: Icons.notFound, 403: Icons.forbidden, 500: Icons.serverError } as const;

/**
 * An error page's content (#542), inside its role's shell: the code, large and discreet, with its Lucide icon, the
 * `title` (the page's `<h1>`), a reassuring text, then the `actions` (ErrorActions). Centred, in either Density.
 */
export function ErrorView({ code, title, children, actions }: { code: ErrorCode; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const Icon = ICON[code];
  return (
    <section className="ds-error" aria-labelledby="error-title">
      <p className="ds-error__code" aria-hidden>
        <Icon />
        <span>{code}</span>
      </p>
      <h1 id="error-title" className="ds-error__title">
        {title}
      </h1>
      <div className="ds-error__text">{children}</div>
      {actions}
    </section>
  );
}
