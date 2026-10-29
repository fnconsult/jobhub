"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { createContext, useContext, useState, type HTMLAttributes, type ReactNode } from "react";
import "./overlay.css";

/** Where Drawers and Dialogs open: the nearest OverlayScope, or the page's body. */
const OverlayContainer = createContext<HTMLElement | null>(null);

/**
 * A part of a page whose Drawers and Dialogs open inside it rather than on the page's body, so they take the theme and
 * the Density it sets (`data-theme`, `data-density`): the Design System page's catalogue, in the theme and Density its
 * toggles chose (#463). Everything else about it is a `<div>`'s.
 */
export function OverlayScope({ children, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; "data-theme"?: string; "data-density"?: string }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} {...props}>
      <OverlayContainer.Provider value={container}>{children}</OverlayContainer.Provider>
    </div>
  );
}

/** A Drawer's or a Dialog's portal: into the nearest OverlayScope, or the page's body. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const container = useContext(OverlayContainer);
  return <RadixDialog.Portal container={container ?? undefined}>{children}</RadixDialog.Portal>;
}

/** What dims the page behind a Drawer or a Dialog (`--color-scrim`); clicking it closes them. */
export function Scrim() {
  return <RadixDialog.Overlay className="ds-scrim" />;
}
