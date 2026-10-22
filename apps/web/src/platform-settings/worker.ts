/** What the worker uses of Platform Settings (`@jobhub/web/platform-settings`): the same catalog and resolver as the web app. */
export { parseSetting, PLATFORM_SETTINGS, platformSetting, readNumberSetting, type PlatformSetting } from "./catalog";
export { createPlatformSettingsResolver, type PlatformSettingsResolver, type PlatformSettingsSnapshot, type ResolvedPlatformSetting } from "./resolver";
export { watchPlatformSettings, type WatchedPlatformSettings } from "./watch";
