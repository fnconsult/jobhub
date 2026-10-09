import { defineConfig } from "wxt";

// The web app whose session the extension shares (see src/candidate-session.ts).
const webOrigin = process.env.WXT_WEB_ORIGIN || "http://localhost:3000";

// One MV3 build for Chrome and Microsoft Edge: only APIs and manifest keys both support.
export default defineConfig({
  // Its own dev server port: WXT otherwise prefers 3000, the web app's (webOrigin above),
  // and whichever dev server started first would take it (#71).
  dev: { server: { port: 3100 } },
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "fr",
    // activeTab + scripting: manual Capture of the page the person is viewing, on their click (ADR-0002).
    // storage: the Guest session (storage.session, in memory). alarms: forgetting it on time (ADR-0003).
    // Job boards are reached through the badge content script's matches (src/job-page.ts, JOB_SITES).
    permissions: ["activeTab", "scripting", "storage", "alarms"],
    // Asked only when the person opts in, from the popup, to the badge on every site (src/all-sites-detection.ts, ALL_SITES).
    optional_host_permissions: ["https://*/*"],
    // Lets the browser send the web app's session cookie with the extension's requests.
    host_permissions: [`${webOrigin}/*`],
  },
});
