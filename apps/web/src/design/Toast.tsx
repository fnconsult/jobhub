"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./Toast.css";

/** How long a Toast stays, unless it holds the focus or the pointer. */
export const TOAST_DURATION_MS = 6000;

export type ToastMessage = { message: ReactNode; link?: { label: ReactNode; href: string } };

const ShowToast = createContext<((toast: ToastMessage) => void) | null>(null);

/**
 * Shows a Toast: a short message at the bottom centre of the page, with an optional link (« Voir la candidature »).
 * Only inside a ToastProvider.
 */
export function useToast(): (toast: ToastMessage) => void {
  const show = useContext(ShowToast);
  if (!show) throw new Error("useToast() needs a ToastProvider");
  return show;
}

/**
 * Holds the page's one Toast (#462). Its message is said in a polite live region, always in the page so screen
 * readers hear it. It goes after TOAST_DURATION_MS, but never while it holds the focus or the pointer; Escape inside
 * it closes it and gives the focus back to what had it when it appeared. A new Toast replaces the one shown.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<(ToastMessage & { key: number }) | null>(null);
  const [held, setHeld] = useState({ focus: false, pointer: false });
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback((toast: ToastMessage) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShown((previous) => ({ ...toast, key: (previous?.key ?? 0) + 1 }));
  }, []);

  const holding = held.focus || held.pointer;
  useEffect(() => {
    if (!shown || holding) return;
    const timer = setTimeout(() => setShown(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shown, holding]);

  function dismiss() {
    setShown(null);
    setHeld({ focus: false, pointer: false });
    opener.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    dismiss();
  }

  return (
    <ShowToast.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="ds-toast-region">
        {shown ? (
          <div
            key={shown.key}
            className="ds-toast"
            onKeyDown={onKeyDown}
            onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld((h) => ({ ...h, focus: false }));
            }}
            onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
            onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
          >
            <span>{shown.message}</span>
            {shown.link ? (
              <Link className="ds-toast__link" href={shown.link.href} onClick={() => setShown(null)}>
                {shown.link.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </ShowToast.Provider>
  );
}
