import { API_VERSION } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import extensionPackage from "../package.json";
import { API_VERSION_HEADERS, createExtensionUpdate, UPDATE_HELP_PATH, UPDATE_STORAGE_KEY, updateHref, updateRequiredBy, type UpdateStorage } from "./extension-update";

const STORE = "https://chromewebstore.google.com/detail/jobbbox/abcdefghijklmnopabcdefghijklmnop";

/** chrome.storage.local, in memory, counting its writes. */
function localStorage() {
  const items: Record<string, unknown> = {};
  let writes = 0;
  const storage: UpdateStorage = {
    get: async (key) => (key in items ? { [key]: structuredClone(items[key]) } : {}),
    set: async (values) => void (writes++, Object.assign(items, structuredClone(values))),
    remove: async (key) => void (writes++, delete items[key]),
  };
  return { storage, items, writes: () => writes };
}

describe("« Mettez à jour l'extension » (#564)", () => {
  it("states the API Version this build speaks, and its Extension Version (#924): package.json's, the manifest's", () => {
    expect(API_VERSION_HEADERS).toEqual({ "Jobbbox-Api-Version": String(API_VERSION), "Jobbbox-Extension-Version": extensionPackage.version });
    expect(extensionPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reads the update asked from the web app's 426 and its stable code only", () => {
    expect(updateRequiredBy(426, { error: "extension_outdated", storeUrl: STORE, apiVersion: 2 })).toEqual({ storeUrl: STORE });
    expect(updateRequiredBy(426, { error: "extension_outdated", storeUrl: null })).toEqual({ storeUrl: null });
    // Only a store page in https is followed.
    expect(updateRequiredBy(426, { error: "extension_outdated", storeUrl: "javascript:alert(1)" })).toEqual({ storeUrl: null });
    expect(updateRequiredBy(426, { error: "something_else" })).toBeNull();
    expect(updateRequiredBy(426, null)).toBeNull();
    expect(updateRequiredBy(200, { error: "extension_outdated" })).toBeNull();
    expect(updateRequiredBy(503, { error: "maintenance" })).toBeNull();
  });

  it("remembers the update asked across the extension's pages, and forgets it once the web app serves it again", async () => {
    const { storage, writes } = localStorage();
    const background = createExtensionUpdate(storage);
    const panel = createExtensionUpdate(storage);

    expect(await panel.required()).toBeNull();
    await background.answered({ storeUrl: STORE });
    expect(await panel.required()).toEqual({ storeUrl: STORE });
    await panel.answered({ storeUrl: STORE });
    expect(writes()).toBe(1);

    await background.answered(null);
    expect(await panel.required()).toBeNull();
    await background.answered(null);
    expect(writes()).toBe(2);
  });

  it("forgets an update asked of an earlier build, which spoke an older API Version", async () => {
    const { storage, items } = localStorage();
    await createExtensionUpdate(storage, 1).answered({ storeUrl: STORE });
    expect(items[UPDATE_STORAGE_KEY]).toEqual({ apiVersion: 1, storeUrl: STORE });
    expect(await createExtensionUpdate(storage, 2).required()).toBeNull();
  });

  it("never throws when the browser's storage fails", async () => {
    const failing: UpdateStorage = { get: () => Promise.reject(new Error("quota")), set: () => Promise.reject(new Error("quota")), remove: () => Promise.reject(new Error("quota")) };
    const update = createExtensionUpdate(failing);
    await expect(update.answered({ storeUrl: STORE })).resolves.toBeUndefined();
    await expect(update.required()).resolves.toBeNull();
  });

  it("leads to the store page, else to the Help Article on the web app", () => {
    expect(updateHref({ storeUrl: STORE }, "https://app.jobbbox.fr")).toBe(STORE);
    expect(updateHref({ storeUrl: null }, "https://app.jobbbox.fr")).toBe(`https://app.jobbbox.fr${UPDATE_HELP_PATH}`);
  });
});
