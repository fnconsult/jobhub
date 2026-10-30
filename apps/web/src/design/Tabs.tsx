"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import "./Tabs.css";

export type Tab<V extends string> = { value: V; label: ReactNode; content: ReactNode };

/**
 * Tabs (Radix, ADR-0018), the active one underlined. Its list takes one Tab stop, on the active tab; the arrow keys
 * move between tabs, wrapping round, and show the one focused; Home and End go to the ends; Tab then goes into the
 * panel. `label` names the list for screen readers. Uncontrolled from `defaultValue` (the first tab), or controlled
 * with `value` and `onValueChange` (a tab kept in the address). `keepMounted`: every panel stays in the page, only the
 * active one shown, so what is typed in another tab (a draft being edited) is kept (#467).
 */
export function Tabs<V extends string>({
  label,
  tabs,
  value,
  defaultValue,
  onValueChange,
  keepMounted = false,
}: {
  label: string;
  tabs: Tab<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  keepMounted?: boolean;
}) {
  return (
    <RadixTabs.Root
      className="ds-tabs"
      value={value}
      defaultValue={value === undefined ? (defaultValue ?? tabs[0]?.value) : undefined}
      onValueChange={(next) => onValueChange?.(next as V)}
    >
      <RadixTabs.List className="ds-tabs__list" aria-label={label}>
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className="ds-tabs__tab">
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.value} value={tab.value} className="ds-tabs__panel" forceMount={keepMounted || undefined}>
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
