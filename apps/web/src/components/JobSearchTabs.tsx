"use client";

import type { ReactNode } from "react";
import { Tabs } from "@/design/Tabs";

/**
 * The latest Job Search results of several Profiles, one tab each (the Design System's Tabs, #467):
 * each tab names its Profile; its panel is rendered on the server. Every panel stays
 * mounted, only the selected one shows.
 */
export function JobSearchTabs({ label, tabs }: { label: string; tabs: { value: string; label: string; panel: ReactNode }[] }) {
  return <Tabs label={label} tabs={tabs.map(({ value, label: name, panel }) => ({ value, label: name, content: panel }))} keepMounted />;
}
