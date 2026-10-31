/**
 * Paramètres in tabs (#396, ADR-0042): one tab per kind of Tool (Recherche web, IA, Sources,
 * Enrichissement de contacts, E-mail, Paiement, Connexion), then Extension and, last, Environnement.
 *
 *   parametresTab(searchParams.tab)        the tab the address names, the first one otherwise
 *   parametresHref("sources", query, hash) a tab's address: the tab is in the URL, so a reload keeps it
 *   settingHref(name) / providerSheetHref  a Platform Setting's row, a Tool's sheet, on the tab that shows it
 *   legacyRedirect("cles", query)          where Clés, Connexion and Sites de recherche now are
 *   addTypeFor(tab, asked, allowed)        what « + Ajouter » adds, preselected from the tab
 *   possibleProviders(tab, state)          « Fournisseurs possibles »: each Tool of the tab's kind, active or not,
 *                                          its keys, its state and what it serves
 *
 * Which Tools, Platform Settings and active provider each tab shows is said here once; the page only lays
 * them out.
 */
import { PRICE_SETTINGS, SEARCH_TASK, taskRouteFromEnv, TEXT_TASKS } from "@jobhub/ai";
import { TOOLS, type Tool, type ToolCategory } from "@jobhub/shared";
import { isProviderSecretName } from "../provider-secrets/catalog";
import type { ProviderSecretStatus } from "../provider-secrets/index";
import { routes } from "../routes";
import { toolStatus, type ToolState, type ToolsState } from "../tools/index";
import { overSettings } from "./ai-routing";
import { ENV_ONLY_SETTINGS, parseSetting, PLATFORM_SETTINGS, platformSetting } from "./catalog";
import type { PlatformSettingsSnapshot } from "./resolver";

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

const namesOf = (groups: readonly string[]) => PLATFORM_SETTINGS.filter((setting) => groups.includes(setting.group)).map((setting) => setting.name);
/**
 * Recherche web's settings: the active Search provider and its fallback, each provider's typed settings (ADR-0043), the
 * one they replace, then the web search's bounded settings (#386, #402) and the EUR/USD rate its prices are converted at (#403).
 */
const WEB_SEARCH_SETTINGS = [
  "AI_WEB_SEARCH_PROVIDER",
  "AI_WEB_SEARCH_FALLBACK_PROVIDER",
  "PERPLEXITY_SEARCH_TYPE",
  "PERPLEXITY_QUERIES_PER_CALL",
  "BRAVE_MAX_PAGES",
  "TAVILY_SEARCH_DEPTH",
  "AI_WEB_SEARCH_MODEL",
  ...namesOf(["web_search"]),
  "EUR_PER_USD",
];

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
  { id: "environment", slug: "environnement", toolCategories: [], settings: namesOf(["maintenance", "candidate_pages"]) },
];

/** What « + Ajouter » adds (#396): a provider (its key, on its sheet), a key, a model, a source, a Job discovery site, a Job Site or a Sign-in Provider. */
export const ADD_TYPES = ["provider", "key", "model", "source", "job_discovery_site", "job_site", "sign_in_provider"] as const;
export type AddType = (typeof ADD_TYPES)[number];

/** The type « + Ajouter » offers first on each tab. */
const ADD_TYPE_OF_TAB: Record<ParametresTabId, AddType> = {
  web_search: "provider",
  ai: "model",
  sources: "source",
  contact_enrichment: "provider",
  email: "key",
  billing: "key",
  sign_in: "sign_in_provider",
  extension: "job_site",
  environment: "key",
};

/** The type « + Ajouter » shows: the one `asked` for, else the tab's, among those `allowed`; else the first allowed, none when none is. */
export function addTypeFor(tab: ParametresTab, asked: string | undefined, allowed: readonly AddType[]): AddType | undefined {
  const wanted = [asked, ADD_TYPE_OF_TAB[tab.id]].find((type): type is AddType => allowed.includes(type as AddType));
  return wanted ?? allowed[0];
}

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

/** The prices of `tool`'s billed units (#403), on its sheet; none for a Tool billed otherwise. */
export const pricesOfTool = (tool: Tool): readonly string[] => PRICE_SETTINGS.filter((price) => price.provider === tool.id).map((price) => price.name);

/**
 * The settings changed on `tool`'s sheet rather than on its tab: Email intake's (#448), on the sheet of Brevo Inbound,
 * its Tool, beside its key and its Recognised senders. None for another Tool.
 */
export const sheetSettingsOf = (tool: Tool): readonly string[] => (tool.id === EMAIL_INTAKE_TOOL ? namesOf(["email_intake"]) : []);

/** Email intake's Tool (#442, #448): Brevo Inbound Parsing, whose sheet is the Email intake sheet. */
export const EMAIL_INTAKE_TOOL = "brevo-inbound";

/** A setting's row on the tab that shows it: a Tool's price or own setting on its sheet, Environnement for one only env holds. */
export function settingHref(name: string): string {
  const sheetTool = (TOOLS as readonly Tool[]).find((tool) => pricesOfTool(tool).includes(name) || sheetSettingsOf(tool).includes(name));
  const sheet = sheetTool ? tabOfTool(sheetTool) : undefined;
  if (sheetTool && sheet) return parametresHref(sheet.id, { fournisseur: sheetTool.id }, `setting-${name}`);
  const tab = PARAMETRES_TABS.find((candidate) => candidate.settings.includes(name) && !(name in ENV_ONLY_SETTINGS))?.id ?? "environment";
  return parametresHref(tab, {}, `setting-${name}`);
}

/** The Tool a key is for: the first that needs it (Brevo's API key: Brevo's API, its SMTP URL: Brevo's SMTP relay). */
export const toolOfKey = (name: string): Tool | undefined => (TOOLS as readonly Tool[]).find((tool) => tool.keys.includes(name) && tabOfTool(tool));

/** A key's place: the sheet of the Tool it is for. */
export function keyHref(name: string): string | undefined {
  const tool = toolOfKey(name);
  return tool ? providerSheetHref(tool) : undefined;
}

/** What a test sign-in brings back to Connexion (TestSignInButton, auth/index.ts): kept through its old address. */
const SIGN_IN_RETURN = ["tested", "testFailed", "error"] as const;

const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? undefined : value);

/** Where an old address now is (#396): Clés on the sheet of the Tool its key is for, Connexion and Sites de recherche on their tab. */
export function legacyRedirect(page: "cles" | "connexion" | "sites", query: Record<string, string | string[] | undefined>): string {
  switch (page) {
    case "cles": {
      return keyHref(first(query.key) ?? "") ?? parametresHref("web_search");
    }
    case "connexion":
      return parametresHref("sign_in", Object.fromEntries(SIGN_IN_RETURN.map((name) => [name, first(query[name])])));
    case "sites":
      return parametresHref("sources");
  }
}

/** What a tab's providers are read from: the Tools' state, and the Provider Secrets as Clés lists them (null: not shown to this reader). */
export interface ProvidersState extends ToolsState {
  settings: PlatformSettingsSnapshot;
  secrets: readonly ProviderSecretStatus[] | null;
}

/** One key a Tool needs: set or not; for a Provider Secret shown to its reader, its source, last 4 characters and last connection test. */
export interface KeyState {
  name: string;
  /** A Provider Secret, replaced, cleared and tested on the Tool's sheet; otherwise env's alone. */
  secret: boolean;
  set: boolean;
  source?: ProviderSecretStatus["source"];
  fingerprint?: string | null;
  lastTest?: ProviderSecretStatus["lastTest"];
}

/** What a possible provider serves: an AI task (`ai_usage` tasks, `identity` for the EU AI consent route), or a feature. */
export type UsedBy = string;

export interface PossibleProvider extends ToolState {
  tool: Tool;
  /** The tab's active provider (« Fournisseur actif »). */
  active: boolean;
  /** « Rendre actif » can choose it: the tab has an active provider and it is another one. A missing key warns, never hides it. */
  selectable: boolean;
  keys: KeyState[];
  /** What it serves while it can be called: none when it cannot (a key missing, off). */
  usedBy: UsedBy[];
}

/** The feature a Tool of each kind serves, for a kind whose Tools are not routed AI tasks. */
const FEATURES: Partial<Record<ToolCategory, UsedBy>> = {
  job_discovery: "job_discovery",
  contact_enrichment: "enriched_contacts",
  mail: "email",
  billing: "billing",
  sign_in: "sign_in",
};

/**
 * The AI tasks, as the AI layer routes them: not read from the setting names, since AI_WEB_SEARCH_FALLBACK_PROVIDER
 * (#398) names a provider for no task of its own.
 */
const AI_TASKS = [...Object.keys(TEXT_TASKS), SEARCH_TASK] as Parameters<typeof taskRouteFromEnv>[1][];

/** The provider each AI task is routed to, as the AI layer would route it; none for a value it refuses. */
function taskProviders(state: ProvidersState): Map<string, string> {
  const env = overSettings(state.env, state.settings.env);
  try {
    return new Map(AI_TASKS.map((task) => [task, taskRouteFromEnv(env, task).provider]));
  } catch {
    return new Map();
  }
}

/** The value of `name` in use, as the code reads it (a provider in lower case). */
function settingValue(state: ProvidersState, name: string): string {
  const resolved = state.settings.setting(name);
  const setting = platformSetting(name);
  if (!resolved?.value || !setting) return resolved?.value ?? "";
  const parsed = parseSetting(setting, resolved.value);
  return parsed.ok ? String(parsed.value) : resolved.value;
}

const callable = (state: ToolState) => state.status === "configured" || state.status === "no_key_needed";

/** Every Tool of `tab`'s kind, in the catalog's order, with its state, its keys and what it serves. */
export function possibleProviders(tab: ParametresTab, state: ProvidersState): PossibleProvider[] {
  const tools = (TOOLS as readonly Tool[]).filter((tool) => tab.toolCategories.includes(tool.category));
  if (tools.length === 0) return [];
  const routed = taskProviders(state);
  const active = tab.activeSetting ? settingValue(state, tab.activeSetting) : undefined;
  const choices = tab.activeSetting ? platformSetting(tab.activeSetting)?.type : undefined;
  const secrets = new Map(state.secrets?.map((secret) => [secret.name, secret]));
  return tools.map((tool): PossibleProvider => {
    const status = toolStatus(tool, state);
    const usage = tool.usage;
    const served = (): UsedBy[] => {
      if (!callable(status)) return [];
      if (usage?.table === "ai_usage") {
        const tasks = [...routed].filter(([, provider]) => provider === usage.provider).map(([task]) => task);
        return usage.provider === "mistral" ? [...tasks, "identity"] : tasks;
      }
      const feature = FEATURES[tool.category];
      return feature && (active === undefined || active === tool.id) ? [feature] : [];
    };
    const isActive = active !== undefined && active === tool.id;
    return {
      tool,
      ...status,
      active: isActive,
      selectable: !isActive && choices?.kind === "choice" && choices.values.includes(tool.id),
      keys: tool.keys.map((name): KeyState => {
        const secret = isProviderSecretName(name);
        const shown = secret ? secrets.get(name) : undefined;
        const base = { name, secret, set: Boolean(state.env[name]?.trim()) };
        return shown ? { ...base, source: shown.source, fingerprint: shown.fingerprint, lastTest: shown.lastTest } : base;
      }),
      usedBy: served(),
    };
  });
}
