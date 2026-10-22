import type { PlatformSettingsSnapshot } from "./resolver";

/**
 * The browser extension's Chrome Web Store page that Mon compte's Outils links to (EXTENSION_STORE_URL,
 * #303): the Back Office's, else env's; null, "coming soon", while none is set or env's is not an https URL.
 */
export function extensionStorePage(settings: PlatformSettingsSnapshot): string | null {
  const store = settings.setting("EXTENSION_STORE_URL");
  return store?.value && store.valid ? store.value : null;
}
