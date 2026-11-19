import { sharedPool } from "@/database/pool";
import { extensionStorePage } from "@/platform-settings/extension-store";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { readGettingStarted, type GettingStartedRead } from "./index";

/**
 * The signed-in `candidate`'s account as « Pour bien commencer » reads it (#1069), now; null after its first 14 days.
 * The extension counts as published while Mon compte › Outils offers to install it (EXTENSION_STORE_URL set).
 */
export function currentGettingStarted(candidate: { id: string; createdAt: Date }): Promise<GettingStartedRead | null> {
  const extensionPublished = extensionStorePage(getPlatformSettingsResolver().current()) !== null;
  return readGettingStarted(sharedPool(), candidate, { extensionPublished, now: new Date() });
}
