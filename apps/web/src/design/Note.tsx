import type { ReactNode } from "react";
import { Icons } from "@/components/icons";
import type { DataAttributes } from "./attributes";
import "./Note.css";

export type NoteTone = "info" | "warn" | "danger" | "success";

const ICON = { info: Icons.info, warn: Icons.warning, danger: Icons.danger, success: Icons.success } as const;

/**
 * A message in the page (#462): information, a warning, a danger or a success, its icon (decoration) then its
 * `title` in bold and its text. The words say the tone; the tint and the icon only repeat it. `role` makes it a live
 * region: « status » for what a change did, « alert » for what went wrong. `data-*` attributes are a page's hooks.
 */
export function Note({ tone = "info", title, role, children, ...data }: DataAttributes & { tone?: NoteTone; title?: ReactNode; role?: "status" | "alert"; children?: ReactNode }) {
  const Icon = ICON[tone];
  return (
    <div {...data} className="ds-note" data-tone={tone} role={role}>
      <Icon />
      <div>
        {title ? <strong className="ds-note__title">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
