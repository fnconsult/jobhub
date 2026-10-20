import { routes } from "../routes";
import type { BackOfficeAccess, BackOfficeResource } from "./access";

/** The Back Office's pages (its sections), each covered by one resource: an Administrator sees a section when a role lets them read it. */
export const BACK_OFFICE_PAGES = {
  plans: { href: routes.adminPlans, resource: "plans" },
  planQuotas: { href: routes.adminPlanQuotas, resource: "planQuotas" },
  coupons: { href: routes.adminCoupons, resource: "coupons" },
  humanCoaches: { href: routes.adminHumanCoaches, resource: "humanCoaches" },
  coachCost: { href: routes.adminCoachCost, resource: "coachMessageCost" },
  coachingPlaybooks: { href: routes.adminCoachingPlaybooks, resource: "coachingPlaybooks" },
  guardrails: { href: routes.adminGuardrails, resource: "guardrails" },
  providerSecrets: { href: routes.adminProviderSecrets, resource: "providerSecrets" },
  signInProviders: { href: routes.adminSignInProviders, resource: "ssoProviders" },
  aiUsage: { href: routes.adminAiUsage(), resource: "aiUsage" },
  aiMessages: { href: routes.adminAiMessages(), resource: "aiMessages" },
  searchSites: { href: routes.adminSearchSites, resource: "searchSites" },
  tools: { href: routes.adminTools, resource: "tools" },
  administrators: { href: routes.adminAdministrators, resource: "roles" },
  journal: { href: routes.adminJournal(), resource: "audit" },
} as const satisfies Record<string, { href: string; resource: BackOfficeResource }>;

export type BackOfficePage = keyof typeof BACK_OFFICE_PAGES;

/**
 * The sidebar's groups, in order (map #123).
 */
const GROUPS = [
  { key: "offer", sections: ["plans", "planQuotas", "coupons"] },
  { key: "coaching", sections: ["humanCoaches", "coachCost", "coachingPlaybooks", "guardrails"] },
  { key: "platform", sections: ["providerSecrets", "signInProviders", "aiUsage", "aiMessages", "searchSites", "tools"] },
  { key: "team", sections: ["administrators", "journal"] },
] as const satisfies ReadonlyArray<{ key: string; sections: readonly BackOfficePage[] }>;

export type BackOfficeNavGroupKey = (typeof GROUPS)[number]["key"];

export interface BackOfficeNavGroup {
  key: BackOfficeNavGroupKey;
  sections: { key: BackOfficePage; href: string }[];
}

/** The Back Office navigation for `access`: only the sections it covers, and only groups with one. */
export function backOfficeNav(access: BackOfficeAccess): BackOfficeNavGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    sections: group.sections
      .filter((key) => access.can(BACK_OFFICE_PAGES[key].resource, "read"))
      .map((key) => ({ key, href: BACK_OFFICE_PAGES[key].href })),
  })).filter((group) => group.sections.length > 0);
}
