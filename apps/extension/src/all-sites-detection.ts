/**
 * Detecting postings on every site, so an employer's own career site gets the
 * "Analyser cette offre" badge too when it publishes a schema.org JobPosting.
 *
 * By default the badge's content script runs on JOB_SITES only, and Capture is
 * manual elsewhere: the extension does not ask to read every site the person
 * visits. The person can opt in from the popup, which asks the browser for
 * ALL_SITES (an optional host permission); the background then registers the
 * same content script for every other site, and removes it when the permission
 * is taken back. Pages are still read in the person's own browser (ADR-0002).
 */
import { JOB_SITES } from "./job-page";

/** The optional host permission the person grants (wxt.config.ts, optional_host_permissions). */
export const ALL_SITES: readonly string[] = ["https://*/*"];

const SCRIPT_ID = "job-page-all-sites";
/** The badge's content script, as built from entrypoints/job-page.content.ts. */
const SCRIPT_FILE = "content-scripts/job-page.js";

/** The part of chrome.permissions this module uses. */
export interface Permissions {
  contains(permissions: { origins: string[] }): Promise<boolean>;
}

interface RegisteredContentScript {
  id: string;
  matches: string[];
  excludeMatches: string[];
  js: string[];
  runAt: "document_idle";
  persistAcrossSessions: boolean;
}

/** The part of chrome.scripting this module uses. */
export interface Scripting {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<unknown[]>;
  registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

export interface AllSitesDetection {
  /** Runs the badge on every site exactly when the person has granted ALL_SITES; says whether it does. */
  sync(): Promise<boolean>;
}

export function createAllSitesDetection({ permissions, scripting }: { permissions: Permissions; scripting: Scripting }): AllSitesDetection {
  async function sync(): Promise<boolean> {
    const granted = await permissions.contains({ origins: [...ALL_SITES] });
    const registered = (await scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
    if (granted && !registered) {
      await scripting.registerContentScripts([
        {
          id: SCRIPT_ID,
          matches: [...ALL_SITES],
          excludeMatches: [...JOB_SITES],
          js: [SCRIPT_FILE],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    }
    if (!granted && registered) await scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return granted;
  }

  // One sync at a time: two at once (install and a permission change, say) would register the script twice.
  let last: Promise<unknown> = Promise.resolve();
  return {
    sync() {
      const next = last.then(sync, sync);
      last = next.catch(() => undefined);
      return next;
    },
  };
}
