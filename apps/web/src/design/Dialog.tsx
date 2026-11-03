"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { OverlayPortal, Scrim } from "./overlay";
import { useHydrated } from "./hydrated";
import "./Dialog.css";

/**
 * A confirmation, and only that (#462): an alert dialog (Radix Dialog, ADR-0018) named by its `title` (the question)
 * and described by its text, with « Annuler » and the confirming button. The focus starts on « Annuler », the safe
 * choice; Escape or « Annuler » close it without confirming; the confirming button calls `onConfirm` then closes it.
 * The focus comes back to its trigger. `tone="danger"` for a destructive action (a solid danger button). Anything
 * longer, a form, goes in a Drawer.
 */
export function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  confirmLabel,
  onConfirm,
  tone = "default",
  children,
}: {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  confirmLabel: ReactNode;
  onConfirm: () => void;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const hydrated = useHydrated();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  function change(next: boolean) {
    setOwnOpen(next);
    onOpenChange?.(next);
  }
  return (
    <RadixDialog.Root open={open} onOpenChange={change}>
      {/* Disabled until the page is hydrated: clicked before, it would not open (#446). Its own `disabled` wins. */}
      {trigger ? (
        <RadixDialog.Trigger asChild disabled={!hydrated}>
          {trigger}
        </RadixDialog.Trigger>
      ) : null}
      <OverlayPortal>
        <Scrim />
        <RadixDialog.Content
          role="alertdialog"
          className="ds-dialog"
          aria-describedby={`${id}-text`}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
        >
          <div className="ds-dialog__body">
            <RadixDialog.Title className="ds-dialog__title">{title}</RadixDialog.Title>
            <div id={`${id}-text`} className="ds-dialog__text">
              {children}
            </div>
          </div>
          <footer className="ds-dialog__footer">
            <RadixDialog.Close asChild>
              <Button ref={cancel}>{t("designSystem.cancel")}</Button>
            </RadixDialog.Close>
            <Button
              variant={tone === "danger" ? "dangerSolid" : "primary"}
              onClick={() => {
                onConfirm();
                change(false);
              }}
            >
              {confirmLabel}
            </Button>
          </footer>
        </RadixDialog.Content>
      </OverlayPortal>
    </RadixDialog.Root>
  );
}

/**
 * Information on demand (the Coach IA badge's, the conversations' welcome): a dialog (Radix Dialog, ADR-0018) named by its
 * `title`, its content, and « Fermer », which takes the focus. Escape or « Fermer » close it; the focus comes back to its
 * trigger. Nothing to confirm: a confirmation is a ConfirmDialog.
 */
export function InfoDialog({ trigger, open, onOpenChange, title, children }: { trigger: ReactElement; open?: boolean; onOpenChange?: (open: boolean) => void; title: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  return (
    <RadixDialog.Root {...(open === undefined ? {} : { open })} {...(onOpenChange ? { onOpenChange } : {})}>
      <RadixDialog.Trigger asChild disabled={!hydrated}>
        {trigger}
      </RadixDialog.Trigger>
      <OverlayPortal>
        <Scrim />
        <RadixDialog.Content className="ds-dialog ds-dialog--info" aria-describedby={undefined}>
          <div className="ds-dialog__body">
            <RadixDialog.Title className="ds-dialog__title">{title}</RadixDialog.Title>
            <div className="ds-dialog__content">{children}</div>
          </div>
          <footer className="ds-dialog__footer">
            <RadixDialog.Close asChild>
              <Button>{t("coachPanel.close")}</Button>
            </RadixDialog.Close>
          </footer>
        </RadixDialog.Content>
      </OverlayPortal>
    </RadixDialog.Root>
  );
}
