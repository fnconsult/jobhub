/**
 * « Mettez à jour l'extension » (#564, ADR-0063). Every call to the web app states the API Version this build speaks
 * (API_VERSION_HEADER); the web app serves the current one and the one before, and answers an older one
 * `426 Upgrade Required` with EXTENSION_OUTDATED and its store page. The extension then remembers, in
 * chrome.storage.local, that it must be updated, and the Side Panel says so with a link to the store page, keeping
 * the Guest session (chrome.storage.session) as it is. Remembered for this API Version only: once updated, the new
 * build speaks a later one and forgets it; any other answer from the web app forgets it too.
 * When to raise the API Version: docs/ops/extension-api-version.md.
 */
import { API_VERSION, API_VERSION_HEADER, EXTENSION_OUTDATED } from "@jobhub/shared";

/** The header every call to the web app carries. */
export const API_VERSION_HEADERS: Readonly<Record<string, string>> = { [API_VERSION_HEADER]: String(API_VERSION) };

/** The Help Article the notice links to while the web app names no store page (Paramètres' EXTENSION_STORE_URL). */
export const UPDATE_HELP_PATH = "/aide/extension/faq-extension-update";

/** What the web app asked: an update, from its store page (null while none is set). */
export interface UpdateRequired {
  storeUrl: string | null;
}

/** The update the web app's answer asks for, or null when it asks none. */
export function updateRequiredBy(status: number, body: unknown): UpdateRequired | null {
  if (status !== 426 || typeof body !== "object" || body === null) return null;
  const { error, storeUrl } = body as Record<string, unknown>;
  if (error !== EXTENSION_OUTDATED) return null;
  return { storeUrl: typeof storeUrl === "string" && /^https:\/\//.test(storeUrl) ? storeUrl : null };
}

/** The part of chrome.storage.local this module uses. */
export interface UpdateStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const UPDATE_STORAGE_KEY = "updateRequired";

export interface ExtensionUpdate {
  /** The update asked for this build, if any. */
  required(): Promise<UpdateRequired | null>;
  /** The web app answered: remembers the update it asks for, or forgets one it no longer asks. Never throws. */
  answered(update: UpdateRequired | null): Promise<void>;
}

export function createExtensionUpdate(storage: UpdateStorage, apiVersion: number = API_VERSION): ExtensionUpdate {
  async function required(): Promise<UpdateRequired | null> {
    const stored = (await storage.get(UPDATE_STORAGE_KEY))[UPDATE_STORAGE_KEY];
    if (typeof stored !== "object" || stored === null) return null;
    const kept = stored as Record<string, unknown>;
    // Asked of an earlier build: this one speaks a later API Version.
    if (kept.apiVersion !== apiVersion) return null;
    return { storeUrl: typeof kept.storeUrl === "string" ? kept.storeUrl : null };
  }
  return {
    required: () => required().catch(() => null),
    async answered(update) {
      try {
        // Written only when it changes: most answers ask nothing, and nothing was asked. Read each time, as the
        // background and the Side Panel both answer for it.
        if (JSON.stringify(await required()) === JSON.stringify(update)) return;
        if (update) await storage.set({ [UPDATE_STORAGE_KEY]: { apiVersion, storeUrl: update.storeUrl } });
        else await storage.remove(UPDATE_STORAGE_KEY);
      } catch (error) {
        console.error("Jobbbox: remembering the update asked", error);
      }
    },
  };
}

/** Where « Mettez à jour l'extension » leads: the store page, else the Help Article saying how to update. */
export function updateHref(update: UpdateRequired, webOrigin: string): string {
  return update.storeUrl ?? `${webOrigin}${UPDATE_HELP_PATH}`;
}
