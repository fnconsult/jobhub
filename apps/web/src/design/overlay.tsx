"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import "./overlay.css";

/** What dims the page behind a Drawer or a Dialog (`--color-scrim`); clicking it closes them. */
export function Scrim() {
  return <RadixDialog.Overlay className="ds-scrim" />;
}
