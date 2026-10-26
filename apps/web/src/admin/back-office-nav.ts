import { routes } from "../routes";
import type { BackOfficeAccess, BackOfficeResource } from "./access";

/** The Back Office's pages (its sections), each covered by one resource: an Administrator sees a section when a role lets them read it. */
export const BACK_OFFICE_PAGES = {
  signalements: { href: routes.adminSignalements(), resource: "signalements" },
  plans: { href: routes.adminPlans, resource: "plans" },
  planQuotas: { href: routes.adminPlanQuotas, resource: "planQuotas" },
  coupons: { href: routes.adminCoupons, resource: "coupons" },
  humanCoaches: { href: routes.adminHumanCoaches, resource: "humanCoaches" },
  coachCost: { href: routes.adminCoachCost, resource: "coachMessageCost" },
  coachingPlaybooks: { href: routes.adminCoachingPlaybooks, resource: "coachingPlaybooks" },
  guardrails: { href: routes.adminGuardrails, resource: "guardrails" },
  unansweredQuestions: { href: routes.adminUnansweredQuestions(), resource: "unansweredQuestions" },
  // Clés, Connexion and Sites de recherche are tabs and sheets of Paramètres (#396): no sidebar entry, but still the page a denied
  // Administrator is recorded on (#264) and the Back Office Assistant names.
  providerSecrets: { href: routes.adminPlatformSettings, resource: "providerSecrets" },
  platformSettings: { href: routes.adminPlatformSettings, resource: "platformSettings" },
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
  { key: "candidates", sections: ["signalements"] },
  { key: "offer", sections: ["plans", "planQuotas", "coupons"] },
  { key: "coaching", sections: ["humanCoaches", "coachCost", "coachingPlaybooks", "guardrails"] },
  { key: "content", sections: ["unansweredQuestions"] },
  { key: "platform", sections: ["platformSettings", "aiUsage", "aiMessages", "tools"] },
  { key: "team", sections: ["administrators", "journal"] },
] as const satisfies ReadonlyArray<{ key: string; sections: readonly BackOfficePage[] }>;

export type BackOfficeNavGroupKey = (typeof GROUPS)[number]["key"];

export interface BackOfficeNavGroup {
  key: BackOfficeNavGroupKey;
  /** `count`: what waits there for the Administrator, shown next to its name. */
  sections: { key: BackOfficePage; href: string; count?: number }[];
}

/** The sections that show a count, and to whom: those who can act on what it counts (#376). */
export const COUNTED_SECTIONS = ["signalements"] as const satisfies readonly BackOfficePage[];
export type BackOfficeCounts = Partial<Record<(typeof COUNTED_SECTIONS)[number], number>>;

/** Whether `access` is shown `section`'s count: only who may change it. */
export const showsCount = (access: BackOfficeAccess, section: (typeof COUNTED_SECTIONS)[number]): boolean => access.can(BACK_OFFICE_PAGES[section].resource, "write");

const countOf = (access: BackOfficeAccess, key: BackOfficePage, counts: BackOfficeCounts): number | undefined => {
  const counted = COUNTED_SECTIONS.find((section) => section === key);
  return counted && showsCount(access, counted) ? counts[counted] : undefined;
};

/**
 * The Back Office navigation for `access`: only the sections it covers, and only groups with one; with `counts`
 * next to the sections that show one (the Signalements « à traiter »), for those who may act on them.
 */
export function backOfficeNav(access: BackOfficeAccess, counts: BackOfficeCounts = {}): BackOfficeNavGroup[] {
  return GROUPS.map((group) => ({
    key: group.key,
    sections: group.sections
      .filter((key) => access.can(BACK_OFFICE_PAGES[key].resource, "read"))
      .map((key) => {
        const count = countOf(access, key, counts);
        return { key, href: BACK_OFFICE_PAGES[key].href, ...(count === undefined ? {} : { count }) };
      }),
  })).filter((group) => group.sections.length > 0);
}
