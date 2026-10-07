import { describe, expect, it } from "vitest";
import { ALL_SITES, createAllSitesDetection, type Permissions, type Scripting } from "./all-sites-detection";
import { JOB_SITES } from "./job-page";

/** The browser's permissions and registered content scripts, as Chrome keeps them. */
function browserState(granted: boolean) {
  const origins = new Set(granted ? ALL_SITES : []);
  const registered = new Map<string, Parameters<Scripting["registerContentScripts"]>[0][number]>();
  const permissions: Permissions = {
    async contains({ origins: asked }) {
      return asked.every((origin) => origins.has(origin));
    },
  };
  const scripting: Scripting = {
    async getRegisteredContentScripts({ ids }) {
      return ids.filter((id) => registered.has(id)).map((id) => registered.get(id)!);
    },
    async registerContentScripts(scripts) {
      for (const script of scripts) {
        if (registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
        registered.set(script.id, script);
      }
    },
    async unregisterContentScripts({ ids }) {
      for (const id of ids) registered.delete(id);
    },
  };
  return { origins, registered, permissions, scripting };
}

describe("detecting postings on every site, an employer's own career site included", () => {
  it("is off until the person grants the extension every site, so it never reads them by default", async () => {
    const state = browserState(false);

    expect(await createAllSitesDetection(state).sync()).toBe(false);
    expect(state.registered.size).toBe(0);
  });

  it("once granted, runs the badge's content script on every site but the job sites, which have it already", async () => {
    const state = browserState(true);
    const detection = createAllSitesDetection(state);

    expect(await detection.sync()).toBe(true);
    expect([...state.registered.values()]).toEqual([
      {
        id: "job-page-all-sites",
        matches: [...ALL_SITES],
        excludeMatches: [...JOB_SITES],
        js: ["content-scripts/job-page.js"],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
    // Synced again (each start of the browser), it stays registered once.
    expect(await detection.sync()).toBe(true);
    expect(state.registered.size).toBe(1);
  });

  it("stops when the person takes the permission back", async () => {
    const state = browserState(true);
    const detection = createAllSitesDetection(state);
    await detection.sync();

    state.origins.clear();
    expect(await detection.sync()).toBe(false);
    expect(state.registered.size).toBe(0);
  });
});

describe("syncing twice at once", () => {
  it("registers the content script once", async () => {
    const state = browserState(true);
    const detection = createAllSitesDetection(state);

    expect(await Promise.all([detection.sync(), detection.sync()])).toEqual([true, true]);
    expect(state.registered.size).toBe(1);
  });
});
