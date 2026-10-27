/**
 * Back Office Activity (« Activité », #404, ADR-0042): one page, a tab each for what happened, each tab with its own
 * readers and retention: Recherches (the Job discovery runs), Appels IA (the AI Message Log) and Actions des
 * administrateurs (the Back Office Audit). This module says which tabs an Administrator sees, in order, and where the
 * former Journal and Journaux IA addresses now lead.
 */
import { routes } from "../routes";
import type { BackOfficeAccess, BackOfficeResource } from "./access";

export type ActivityTabId = "discoveryRuns" | "aiMessages" | "audit";

export interface ActivityTab {
  id: ActivityTabId;
  href: string;
  /** Who reads it: those whose roles let them read this resource. */
  resource: BackOfficeResource;
}

const TABS: readonly ActivityTab[] = [
  { id: "discoveryRuns", href: routes.adminDiscoveryRuns(), resource: "discoveryRuns" },
  { id: "aiMessages", href: routes.adminAiMessages(), resource: "aiMessages" },
  { id: "audit", href: routes.adminAudit(), resource: "audit" },
];

/** The tabs `access` reads, in order; the first is where Activité's own address leads. */
export function activityTabs(access: BackOfficeAccess): ActivityTab[] {
  return TABS.filter((tab) => access.can(tab.resource, "read"));
}

/** A query string's values, the repeated ones left out. */
const single = (query: Record<string, string | string[] | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""));

/**
 * Where the former Journal (`/admin/journal`) and Journaux IA (`/admin/journaux-ia`, and one log, `id`) lead now: their
 * tab of Activité, with their filters. The tab checks the Back Office Roles.
 */
export function legacyActivityRedirect(page: "journal" | "journaux-ia", query: Record<string, string | string[] | undefined>, id?: string): string {
  if (page === "journal") {
    const { section, outcome } = single(query);
    return routes.adminAudit({ section, outcome });
  }
  return id ? routes.adminAiMessage(id) : routes.adminAiMessages(single(query));
}
