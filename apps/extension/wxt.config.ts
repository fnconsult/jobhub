import { defineConfig } from "wxt";

// The web app whose session the extension shares (see src/candidate-session.ts).
const webOrigin = process.env.WXT_WEB_ORIGIN || "http://localhost:3000";

// Chrome MV3 extension shell. Job Offer Capture will live here (see CONTEXT.md).
export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "fr",
    permissions: [],
    // Lets the browser send the web app's session cookie with the extension's requests.
    host_permissions: [`${webOrigin}/*`],
  },
});
