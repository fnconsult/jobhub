"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icons } from "@/components/icons";
import { buttonClass } from "./button-class";

/**
 * The public header's links (#544): in a row on a wide screen; on a phone, behind « Menu », a disclosure that opens
 * them under the header. Escape closes it, the focus back on « Menu »; going to another page closes it too.
 */
export function PublicSiteMenu({ label, menu, children }: { label: string; menu: string; children: ReactNode }) {
  const id = useId();
  const pathname = usePathname();
  // Open on the page it was opened on: going to another page closes it.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenPath(null);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={button}
        className={`${buttonClass({ variant: "quiet", size: "sm" })} ds-site__menu`}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpenPath(open ? null : pathname)}
      >
        {open ? <Icons.close /> : <Icons.menu />}
        {menu}
      </button>
      <nav id={id} className="ds-site__nav" aria-label={label} data-open={open || undefined}>
        {children}
      </nav>
    </>
  );
}
