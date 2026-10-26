/**
 * Paramètres in tabs (#396, ADR-0042): one tab per kind of Tool (Recherche web, IA, Sources,
 * Enrichissement de contacts, E-mail, Paiement, Connexion), then Extension and, last, Environnement.
 *
 *   parametresTab(searchParams.tab)        the tab the address names, the first one otherwise
 *   parametresHref("sources", query, hash) a tab's address: the tab is in the URL, so a reload keeps it
 *   settingHref(name) / providerSheetHref  a Platform Setting's row, a Tool's sheet, on the tab that shows it
 *   legacyRedirect("cles", query)          where Clés, Connexion and Sites de recherche now are
 *
 * Which Tools, Platform Settings and active provider each tab shows is said here once; the page only lays
 * them out.
 */
import { TOOLS, type Tool, type ToolCategory } from "@jobhub/shared";
import { routes } from "../routes";
import { ENV_ONLY_SETTINGS, PLATFORM_SETTINGS } from "./catalog";

export type ParametresTabId = "web_search" | "ai" | "sources" | "contact_enrichment" | "email" | "billing" | "sign_in" | "extension" | "environment";

export interface ParametresTab {
  id: ParametresTabId;
  /** Its value of `?tab=` in the address. */
  slug: string;
  /** The kinds of Tool its « Fournisseurs possibles » lists. */
  toolCategories: readonly ToolCategory[];
  /** The Platform Setting naming its active provider (« Fournisseur actif »), whose values are its Tools' ids. */
  activeSetting?: string;
  /** The settings its « Fournisseur actif » card shows, in order: Platform Settings, and those only env holds (read-only). */
  settings: readonly string[];
}

const WEB_SEARCH_SETTINGS = ["AI_WEB_SEARCH_PROVIDER", "AI_WEB_SEARCH_MODEL"];
const namesOf = (groups: readonly string[]) => PLATFORM_SETTINGS.filter((setting) => groups.includes(setting.group)).map((setting) => setting.name);

export const PARAMETRES_TABS: readonly ParametresTab[] = [
  { id: "web_search", slug: "recherche-web", toolCategories: ["web_search"], activeSetting: "AI_WEB_SEARCH_PROVIDER", settings: WEB_SEARCH_SETTINGS },
  { id: "ai", slug: "ia", toolCategories: ["ai_model"], settings: namesOf(["ai_routing"]).filter((name) => !WEB_SEARCH_SETTINGS.includes(name)) },
  { id: "sources", slug: "sources", toolCategories: ["job_discovery"], settings: namesOf(["job_discovery", "job_digest"]) },
  { id: "contact_enrichment", slug: "enrichissement", toolCategories: ["contact_enrichment"], activeSetting: "CONTACT_ENRICHMENT_PROVIDER", settings: namesOf(["enriched_contacts"]) },
  { id: "email", slug: "e-mail", toolCategories: ["mail"], settings: [...namesOf(["email"]), "MAIL_TRANSPORT"] },
  {
    id: "billing",
    slug: "paiement",
    toolCategories: ["billing"],
    settings: ["STRIPE_PRICE_STANDARD", "STRIPE_PRICE_PREMIUM", "STRIPE_PRICE_COACHING_SESSION", "STRIPE_PRICE_COACHING_SESSION_PREMIUM"],
  },
  { id: "sign_in", slug: "connexion", toolCategories: ["sign_in"], settings: [] },
  { id: "extension", slug: "extension", toolCategories: [], settings: namesOf(["extension"]) },
  { id: "environment", slug: "environnement", toolCategories: [], settings: [] },
];

const byId = (id: ParametresTabId): ParametresTab => PARAMETRES_TABS.find((tab) => tab.id === id)!;

/** The tab `slug` names (`?tab=`), the first one when it names none. */
export const parametresTab = (slug: string | undefined): ParametresTab => PARAMETRES_TABS.find((tab) => tab.slug === slug) ?? PARAMETRES_TABS[0]!;

/** `tab`'s address with `query` (empty values left out) and `hash`. */
export function parametresHref(tab: ParametresTabId, query: Record<string, string | undefined> = {}, hash?: string): string {
  const params = new URLSearchParams({ tab: byId(tab).slug });
  for (const [name, value] of Object.entries(query)) if (value) params.set(name, value);
  return `${routes.adminPlatformSettings}?${params}${hash ? `#${hash}` : ""}`;
}

/** The tab whose « Fournisseurs possibles » lists `tool`; none for a Tool with no setting nor key to change (Reference data, Place suggestions). */
export const tabOfTool = (tool: Tool): ParametresTab | undefined => PARAMETRES_TABS.find((tab) => tab.toolCategories.includes(tool.category));

/** `tool`'s sheet, in a side panel on its tab. */
export function providerSheetHref(tool: Tool): string | undefined {
  const tab = tabOfTool(tool);
  return tab ? parametresHref(tab.id, { fournisseur: tool.id }) : undefined;
}

/** A setting's row on the tab that shows it: Environnement for one only env holds. */
export function settingHref(name: string): string {
  const tab = PARAMETRES_TABS.find((candidate) => candidate.settings.includes(name) && !(name in ENV_ONLY_SETTINGS))?.id ?? "environment";
  return parametresHref(tab, {}, `setting-${name}`);
}

/** The Tool a key is for: the first that needs it (Brevo's API key: Brevo's API, its SMTP URL: Brevo's SMTP relay). */
export const toolOfKey = (name: string): Tool | undefined => (TOOLS as readonly Tool[]).find((tool) => tool.keys.includes(name) && tabOfTool(tool));

/** What a test sign-in brings back to Connexion (TestSignInButton, auth/index.ts): kept through its old address. */
const SIGN_IN_RETURN = ["tested", "testFailed", "error"] as const;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? undefined : value);

/** Where an old address now is (#396): Clés on the sheet of the Tool its key is for, Connexion and Sites de recherche on their tab. */
export function legacyRedirect(page: "cles" | "connexion" | "sites", query: Record<string, string | string[] | undefined>): string {
  switch (page) {
    case "cles": {
      const tool = toolOfKey(first(query.key) ?? "");
      return tool ? providerSheetHref(tool)! : parametresHref("web_search");
    }
    case "connexion":
      return parametresHref("sign_in", Object.fromEntries(SIGN_IN_RETURN.map((name) => [name, first(query[name])])));
    case "sites":
      return parametresHref("sources");
  }
}
