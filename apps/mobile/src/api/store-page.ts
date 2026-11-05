/**
 * Where an outdated build sends the person to update (#704): Google Play's page for the Android package, the App Store's
 * for the app's Apple ID (`extra.appStoreId` in app.json, set once App Store Connect has created the app,
 * docs/ops/mobile.md). Until then, the App Store's search for Jobbbox.
 */
export function storePageFor(
  os: string,
  config: { android?: { package?: string }; extra?: { appStoreId?: string | number | null } } | null | undefined,
): string {
  if (os === "android") return `https://play.google.com/store/apps/details?id=${config?.android?.package ?? "ai.jobbbox.app"}`;
  const id = config?.extra?.appStoreId;
  return id ? `https://apps.apple.com/app/id${id}` : "https://apps.apple.com/search?term=Jobbbox";
}
