"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useState, type ReactNode } from "react";

/**
 * The latest Job Search results of several Profiles, one tab each (Radix Tabs, ADR-0018):
 * each tab names its Profile; its panel is rendered on the server. Every panel stays
 * mounted, only the selected one shows.
 */
export function JobSearchTabs({ label, tabs }: { label: string; tabs: { value: string; label: string; panel: ReactNode }[] }) {
  const [tab, setTab] = useState(tabs[0]?.value ?? "");
  return (
    <Tabs.Root value={tab} onValueChange={setTab}>
      <Tabs.List className="tablist" aria-label={label}>
        {tabs.map(({ value, label: name }) => (
          <Tabs.Trigger key={value} className="tab" value={value}>
            {name}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map(({ value, panel }) => (
        <Tabs.Content key={value} className="tabpanel" value={value} forceMount>
          {panel}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
