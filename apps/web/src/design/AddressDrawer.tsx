"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { DataAttributes } from "./attributes";
import { Drawer } from "./Drawer";

/**
 * A Drawer the address opens (#465): a server page draws it, open, while its address says so (Paramètres'
 * `&fournisseur=perplexity`, Activité's `?run=`), so it survives a reload and a server form's redirect. It is drawn in
 * place, so the server sends it open, its forms working before the page's scripts run. It is the Drawer
 * in every other way: a dialog named by its `title`, the focus inside and kept there, the page behind out of reach.
 * « Fermer », Escape or the scrim go to `closeHref`, the address without it, and put the focus back on `opener` (a
 * selector for the link that opened it, on the page behind) when the page shows it. A page gives it a `key` per thing it
 * shows, so opening another one opens it afresh.
 *
 * What inside it hands over to a panel beside the page (an Explainable label asking the Back Office Assistant, #407)
 * closes it first with `useLeaveAddressDrawer`: a Drawer holds the focus, so the Assistant could not be used beside it.
 * The focus then goes to that panel, not back to the opener.
 */
export function AddressDrawer({
  title,
  closeHref,
  opener,
  size,
  footer,
  children,
  ...data
}: DataAttributes & { title: ReactNode; closeHref: string; opener?: string; size?: "md" | "wide"; footer?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const focusOpener = useRef(true);
  function close() {
    setOpen(false);
    router.push(closeHref, { scroll: false });
  }
  function leave() {
    focusOpener.current = false;
    close();
  }
  return (
    <Leave.Provider value={leave}>
      <Drawer
        {...data}
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onCloseAutoFocus={(event) => {
          if (!focusOpener.current) {
            event.preventDefault();
            return;
          }
          const link = opener ? document.querySelector(opener) : null;
          if (!(link instanceof HTMLElement)) return;
          event.preventDefault();
          link.focus();
        }}
        title={title}
        size={size}
        inPlace
        footer={footer}
      >
        {children}
      </Drawer>
    </Leave.Provider>
  );
}

const Leave = createContext<(() => void) | null>(null);

/** Closes the AddressDrawer this is in, leaving the focus to what takes it next; null outside one. */
export function useLeaveAddressDrawer(): (() => void) | null {
  return useContext(Leave);
}
