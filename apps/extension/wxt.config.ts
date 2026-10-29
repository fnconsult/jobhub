import { defineConfig } from "wxt";
import { JOB_SITES } from "./src/job-page";

// The web app whose session the extension shares (see src/candidate-session.ts).
const webOrigin = process.env.WXT_WEB_ORIGIN || "http://localhost:3000";

// One MV3 build for Chrome and Microsoft Edge: only APIs and manifest keys both support.
export default defineConfig({
  // Its own dev server port: WXT otherwise prefers 3000, the web app's (webOrigin above),
  // and whichever dev server started first would take it (#71). strictPort: when 3100 is
  // taken, fail loudly rather than silently move to a random port the README doesn't give.
  dev: { server: { port: 3100, strictPort: true } },
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "fr",
    // activeTab + scripting: manual Capture of the page the person is viewing, on their click (ADR-0002).
    // storage: the Guest session (storage.session, in memory). alarms: forgetting it on time (ADR-0003).
    // sidePanel: the extension lives in the browser's Side Panel (ADR-0054, entrypoints/sidepanel), not in a popup.
    // Job boards are reached through the badge content script's matches (src/job-page.ts, JOB_SITES).
    permissions: ["activeTab", "scripting", "storage", "alarms", "sidePanel"],
    // The toolbar icon, with no popup: it opens the Side Panel (src/side-panel.ts).
    action: { default_title: "__MSG_extName__" },
    // Asked only when the person opts in, from the Side Panel, to the badge on every site (src/all-sites-detection.ts, ALL_SITES).
    optional_host_permissions: ["https://*/*"],
    // Lets the browser send the web app's session cookie with the extension's requests. And JOB_SITES, which
    // the badge's matches already cover: so Capture may read a job site's iframe in another site's page
    // (gestmax.fr, #187), where activeTab covers only the page itself.
    host_permissions: [`${webOrigin}/*`, ...JOB_SITES],
  },
});
