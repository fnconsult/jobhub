"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icons } from "@/components/icons";
import type { DataAttributes } from "./attributes";
import { Button } from "./Button";
import { OverlayPortal, Scrim } from "./overlay";
import { useHydrated } from "./hydrated";
import "./Drawer.css";

type AutoFocusEvent = Event;

/**
 * A drawer (Radix Dialog, ADR-0018), modal, on the right by default: the detail of a row without leaving the list, or
 * a form. With a `title` it has a header (the title, which names it, and « Fermer »), a body that scrolls and an
 * optional `footer` for its actions; without one, its content draws its own head and holds a DrawerTitle (the
 * Sidebar's menu on a phone). The focus goes inside on opening and stays there; Escape, the scrim or « Fermer » close
 * it, the focus back on its trigger. Full screen on a phone. Opened by its `trigger`, or by its owner (`open`).
 * `size="wide"` for a detail that needs room (a run's table of offers).
 */
export function Drawer({
  trigger,
  open,
  defaultOpen,
  onOpenChange,
  title,
  footer,
  side = "right",
  size = "md",
  className,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  children,
  ...data
}: DataAttributes & {
  trigger?: ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  size?: "md" | "wide";
  className?: string;
  onOpenAutoFocus?: (event: AutoFocusEvent) => void;
  onCloseAutoFocus?: (event: AutoFocusEvent) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {/* Disabled until the page is hydrated: clicked before, it would not open (#446). Its own `disabled` wins. */}
      {trigger ? (
        <RadixDialog.Trigger asChild disabled={!hydrated}>
          {trigger}
        </RadixDialog.Trigger>
      ) : null}
      <OverlayPortal>
        <Scrim />
        <RadixDialog.Content
          {...data}
          className={["ds-drawer", className].filter(Boolean).join(" ")}
          data-side={side}
          data-size={size === "wide" ? size : undefined}
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
        >
          {title !== undefined ? (
            <>
              <header className="ds-drawer__header">
                <DrawerTitle>{title}</DrawerTitle>
                <RadixDialog.Close asChild>
                  <Button variant="quiet" icon={<Icons.close />}>
                    {t("designSystem.close")}
                  </Button>
                </RadixDialog.Close>
              </header>
              <div className="ds-drawer__body">{children}</div>
              {footer ? <footer className="ds-drawer__footer">{footer}</footer> : null}
            </>
          ) : (
            children
          )}
        </RadixDialog.Content>
      </OverlayPortal>
    </RadixDialog.Root>
  );
}

/** The title of a Drawer that draws its own head: it names the drawer for screen readers. */
export function DrawerTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <RadixDialog.Title className={["ds-drawer__title", className].filter(Boolean).join(" ")}>{children}</RadixDialog.Title>;
}
