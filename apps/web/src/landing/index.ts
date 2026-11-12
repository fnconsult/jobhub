import type { PlanCard } from "@/billing/plan-cards";
import { extensionStorePage } from "@/platform-settings/extension-store";
import type { PlatformSettingsSnapshot } from "@/platform-settings/resolver";

/**
 * The landing page (ADR-0105): what a Visitor reads at `/` before signing in. Everything that can change without a
 * release comes from the Back Office and nothing is written in its place: the Plans and their prices from the Plans
 * catalogue, the store links from Paramètres. What is not set is not shown.
 */

/** Where the landing page sends people out of the site; null: that link is not shown. */
export interface LandingStoreLinks {
  /** The extension's Chrome Web Store page (EXTENSION_STORE_URL). */
  extension: string | null;
  /** The app's App Store page (APP_STORE_URL). */
  appStore: string | null;
  /** The app's Google Play page (PLAY_STORE_URL). */
  playStore: string | null;
}

/** A store page set on Paramètres (or in env): an https URL, else none. */
function storePage(settings: PlatformSettingsSnapshot, name: "APP_STORE_URL" | "PLAY_STORE_URL"): string | null {
  const store = settings.setting(name);
  return store?.value && store.valid ? store.value : null;
}

/** The store links as Paramètres sets them: none for a store whose page is not set, or is not an https URL. */
export function landingStoreLinks(settings: PlatformSettingsSnapshot): LandingStoreLinks {
  return { extension: extensionStorePage(settings), appStore: storePage(settings, "APP_STORE_URL"), playStore: storePage(settings, "PLAY_STORE_URL") };
}

/** One offered Plan as the landing page shows it: its name, its price if Stripe gave one, and what it includes. */
export interface LandingPlan {
  key: string;
  name: string;
  /** « 19 € / mois »; null: no price is shown (Stripe unset or unreadable). */
  price: string | null;
  lines: { label: string; value: string; included: boolean }[];
}

/** The offered Plans, as Mon abonnement compares them (planCards), without what belongs to a signed-in Candidate. */
export function landingPlans(cards: readonly PlanCard[]): LandingPlan[] {
  return cards.map(({ key, name, price, quotas }) => ({ key, name, price, lines: quotas.map(({ label, value, included }) => ({ label, value, included })) }));
}
