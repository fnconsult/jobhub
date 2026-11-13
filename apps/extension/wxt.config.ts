import { defineConfig } from "wxt";
import { buildTarget, manifestIcons } from "./src/build-target";
import { JOB_SITES } from "./src/job-page";

// One MV3 build for Chrome and Microsoft Edge: only APIs and manifest keys both support.
// The mode picks the build (src/build-target.ts, #563): `wxt build` / `wxt zip` make the public listing's, tied to
// Production; `--mode beta` the beta listing's, tied to the Beta; `wxt dev` and `--mode e2e` talk to WXT_WEB_ORIGIN.
// The manifest's version is package.json's: the Extension Version, X.Y.Z in digits only (ADR-0063).
export default defineConfig({
  // Its own dev server port: WXT otherwise prefers 3000, the web app's (WXT_WEB_ORIGIN's default),
  // and whichever dev server started first would take it (#71). strictPort: when 3100 is
  // taken, fail loudly rather than silently move to a random port the README doesn't give.
  dev: { server: { port: 3100, strictPort: true } },
  manifestVersion: 3,
  // The zips the extension workflow attaches to its Release: jobbbox-extension-X.Y.Z-chrome.zip and …-chrome-beta.zip.
  zip: { name: "jobbbox-extension" },
  // The web app this build talks to (src/web-app.ts), from its mode rather than from the environment alone. A store
  // build also runs as production whatever its mode: WXT's runtime keeps its « [wxt] » console logging out of it only
  // when MODE is "production", so the beta zip behaves as the public one.
  vite: ({ mode }) => {
    const target = buildTarget(mode, process.env);
    return {
      define: {
        "import.meta.env.WXT_WEB_ORIGIN": JSON.stringify(target.webOrigin),
        ...(target.store ? { "import.meta.env.MODE": JSON.stringify("production"), "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" } : {}),
      },
    };
  },
  hooks: {
    // Each build ships its own icon set only: the beta's never reaches the public listing, nor the other way round.
    "build:publicAssets": (wxt, files) => {
      const other = buildTarget(wxt.config.mode).iconDir === "icon" ? "icon-beta/" : "icon/";
      files.splice(0, files.length, ...files.filter((file) => !file.relativeDest.startsWith(other)));
    },
  },
  manifest: ({ mode }) => {
    const target = buildTarget(mode, process.env);
    return {
      name: target.name,
      description: "__MSG_extDescription__",
      default_locale: "fr",
      icons: manifestIcons(target),
      // activeTab + scripting: manual Capture of the page the person is viewing, on their click (ADR-0002).
      // storage: the Guest session (storage.session, in memory). alarms: forgetting it on time (ADR-0003).
      // sidePanel: the extension lives in the browser's Side Panel (ADR-0054, entrypoints/sidepanel), not in a popup.
      // Job boards are reached through the badge content script's matches (src/job-page.ts, JOB_SITES).
      permissions: ["activeTab", "scripting", "storage", "alarms", "sidePanel"],
      // The toolbar icon, with no popup: it opens the Side Panel (src/side-panel.ts).
      action: { default_title: target.name, default_icon: manifestIcons(target) },
      // Asked only when the person opts in, from the Side Panel, to the badge on every site (src/all-sites-detection.ts, ALL_SITES).
      optional_host_permissions: ["https://*/*"],
      // Lets the browser send the web app's session cookie with the extension's requests. And JOB_SITES, which
      // the badge's matches already cover: so Capture may read a job site's iframe in another site's page
      // (gestmax.fr, #187), where activeTab covers only the page itself.
      host_permissions: [`${target.webOrigin}/*`, ...JOB_SITES],
      // The test zip's fixed id (src/build-target.ts): EXTENSION_ORIGINS lists it once, wherever the zip is unpacked.
      ...(target.key ? { key: target.key } : {}),
    };
  },
});
