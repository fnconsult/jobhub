/**
 * What Paramètres says after a change (#396), read back from the address: each kind of change has its own
 * parameters, so a notice is only ever shown for what was just done, and only names and codes checked against
 * the known ones reach the page.
 */

/** The form fields every Paramètres form carries: where it was sent from, and a super-admin's confirmation (the DPA marked signed, #302). */
export const FORM = { tab: "tab", sheet: "fournisseur", confirmed: "confirmed" } as const;
export const CONFIRMED = "yes";

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
