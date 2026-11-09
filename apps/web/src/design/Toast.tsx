"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./Toast.css";

/** How long a Toast stays, unless it holds the focus or the pointer. */
export const TOAST_DURATION_MS = 6000;

/**
 * A message, with a link to follow (« Voir la candidature ») or an action to take (« Annuler », #816). `action.focus`
 * moves the keyboard focus to the action when the Toast appears, for an action the person just took whose control is
 * going away; `returnFocus` gives the element the focus goes back to when the Toast closes, if the one that had it when
 * it appeared is no longer in the page, or if none had it (a button disabled while it worked loses it).
 */
export type ToastMessage = {
  message: ReactNode;
  link?: { label: ReactNode; href: string };
  action?: { label: ReactNode; onAction: () => void; focus?: boolean };
  returnFocus?: () => HTMLElement | null;
};

const ShowToast = createContext<((toast: ToastMessage) => void) | null>(null);

/**
 * Shows a Toast: a short message at the bottom centre of the page, with an optional link (« Voir la candidature ») or
 * action (« Annuler »), which closes it.
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
 * it closes it and gives the focus back to what had it when it appeared (or, when that is gone or nothing had it, to
 * `returnFocus`). An action with `focus` takes the focus as the Toast appears. A new Toast replaces the one shown.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<(ToastMessage & { key: number }) | null>(null);
  const [held, setHeld] = useState({ focus: false, pointer: false });
  const opener = useRef<HTMLElement | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);

  const show = useCallback((toast: ToastMessage) => {
    // Nothing has the focus (the page itself has it) when the control that acted lost it, disabled while its request
    // ran: the focus goes to `returnFocus` on close, not to the page, which would leave it nowhere.
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setShown((previous) => ({ ...toast, key: (previous?.key ?? 0) + 1 }));
  }, []);

  const holding = held.focus || held.pointer;
  useEffect(() => {
    if (!shown || holding) return;
    const timer = setTimeout(() => setShown(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [shown, holding]);

  // The action takes the focus as its Toast appears, when asked to.
  useEffect(() => {
    if (shown?.action?.focus) actionButton.current?.focus();
  }, [shown]);

  function dismiss() {
    const back = opener.current?.isConnected ? opener.current : (shown?.returnFocus?.() ?? null);
    setShown(null);
    setHeld({ focus: false, pointer: false });
    back?.focus();
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
            {shown.action ? (
              <button
                ref={actionButton}
                type="button"
                className="ds-toast__link ds-toast__action"
                onClick={() => {
                  shown.action?.onAction();
                  dismiss();
                }}
              >
                {shown.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ShowToast.Provider>
  );
}
