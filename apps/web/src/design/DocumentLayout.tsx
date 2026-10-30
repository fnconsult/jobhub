import type { ReactNode } from "react";
import "./DocumentLayout.css";

/**
 * A document's page (#468): the document (the Viewer, then what edits it) and, beside it, its `aside`: what it was made
 * for, what to know about it, its validation and downloads. The aside goes under the document below 56rem.
 */
export function DocumentLayout({ aside, asideLabel, children }: { aside: ReactNode; asideLabel: string; children: ReactNode }) {
  return (
    <div className="ds-document-layout">
      <div className="ds-document-layout__main">{children}</div>
      <aside className="ds-document-layout__aside" aria-label={asideLabel}>
        {aside}
      </aside>
    </div>
  );
}

/** One block of a document's aside: a label in the metadata style over its content. */
export function AsideBlock({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-document-layout__block">
      {label ? <p className="ds-document-layout__label">{label}</p> : null}
      {children}
    </div>
  );
}
