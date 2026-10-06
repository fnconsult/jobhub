import { defineConfig } from "wxt";

// Chrome MV3 extension shell. Job Offer Capture will live here (see CONTEXT.md).
export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "fr",
    permissions: [],
  },
});
