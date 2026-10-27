/**
 * What Paramètres says after a change (#396), read back from the address: each kind of change has its own
 * parameters, so a notice is only ever shown for what was just done, and only names and codes checked against
 * the known ones reach the page.
 */

/** The form fields every Paramètres form carries: where it was sent from, and a super-admin's confirmation (the DPA marked signed, #302). */
export const FORM = { tab: "tab", sheet: "fournisseur", confirmed: "confirmed" } as const;
export const CONFIRMED = "yes";

/** A Sign-in Provider form's switches: the fields saveProvider reads. */
export const SIGN_IN_SWITCHES = { shownToCandidates: "shownToCandidates", allowedForAdministrators: "allowedForAdministrators", trustedForLinking: "trustedForLinking", enabled: "enabled" } as const;

/** A Platform Setting's notice: a key under admin.platformSettings.notices, and whether it is an error. */
export const PLATFORM_SETTING_NOTICES = {
  saved: false,
  unchanged: false,
  restored: false,
  notRestored: false,
  invalid: true,
  empty: true,
  not_editable: true,
  refused: true,
  unconfirmed: true,
  restoreUnconfirmed: true,
} as const;
export type PlatformSettingNotice = keyof typeof PLATFORM_SETTING_NOTICES;
export const isPlatformSettingNotice = (value: unknown): value is PlatformSettingNotice => typeof value === "string" && Object.hasOwn(PLATFORM_SETTING_NOTICES, value);

/** The fields naming an AI task's or a Playbook Agent's side panel (#402): in the address, and in its forms. */
export const AI_FORM = { task: "tache", playbook: "playbook" } as const;

/** What an AI task's route change says (`?route=`): a key under admin.platformSettings.aiTasks.notices. */
export const ROUTE_NOTICES = ["routeSaved", "routeUnchanged", "routeRestored"] as const;
export type RouteNotice = (typeof ROUTE_NOTICES)[number];
export const isRouteNotice = (value: unknown): value is RouteNotice => ROUTE_NOTICES.includes(value as RouteNotice);

/** What a Playbook Agent change says (`?agent=`): saved as a new draft or into the draft, or why not (CoachingPlaybooks' refusals); and whether it is an error. */
export const PLAYBOOK_AGENT_NOTICES = {
  created: false,
  updated: false,
  unchanged: false,
  invalid: true,
  not_found: true,
  model_not_allowed: true,
  task_instructions: true,
  unknown_sources: true,
  sources_cited: true,
} as const;
export type PlaybookAgentNotice = keyof typeof PLAYBOOK_AGENT_NOTICES;
export const isPlaybookAgentNotice = (value: unknown): value is PlaybookAgentNotice => typeof value === "string" && Object.hasOwn(PLAYBOOK_AGENT_NOTICES, value);

/** A Job discovery source's, site's or Job Site's notice (`?sites=`): a key under admin.searchSites.notices, and whether it is an error. */
export const SITES_NOTICES = {
  saved: false,
  jobSiteAdded: false,
  jobSiteRemoved: false,
  jobSiteInvalid: true,
  jobSiteExists: true,
  jobSiteBuiltIn: true,
  siteAdded: false,
  siteRemoved: false,
  siteInvalid: true,
  siteExists: true,
  siteForbidden: true,
  notFound: true,
} as const;
export type SitesNotice = keyof typeof SITES_NOTICES;
export const isSitesNotice = (value: unknown): value is SitesNotice => typeof value === "string" && Object.hasOwn(SITES_NOTICES, value);

/** A Provider Secret's errors, as admin.providerSecrets.errors names them. */
export const SECRET_ERRORS = ["test_failed", "empty", "too_long", "unknown_secret", "no_master_key"] as const;
export type SecretError = (typeof SECRET_ERRORS)[number];
