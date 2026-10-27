/** What the worker uses of Platform Settings (`@jobhub/web/platform-settings`): the same catalog and resolver as the web app. */
export { parseSetting, PLATFORM_SETTINGS, platformSetting, readNumberSetting, readSetting, type PlatformSetting } from "./catalog";
export { createPlatformSettingsResolver, type PlatformSettingsResolver, type PlatformSettingsSnapshot, type ResolvedPlatformSetting, type StoredPlatformSettings } from "./resolver";
export { AI_ROUTING_NAMES, withPlatformSettings } from "./ai-routing";
export { secretsWithSettings } from "./secrets-with-settings";
export { watchPlatformSettings, type WatchedPlatformSettings } from "./watch";
