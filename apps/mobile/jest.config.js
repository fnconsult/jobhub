// The app's tests (ADR-0076): Jest with React Native Testing Library, on jest-expo's preset. The root's Vitest leaves
// apps/mobile to it (vitest.config.ts).
const preset = require("jest-expo/jest-preset");

const [jsTransform] = Object.entries(preset.transform).filter(([pattern]) => pattern === "\\.[jt]sx?$");

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}", "<rootDir>/e2e/**/*.e2e.test.{ts,tsx}"],
  // Packages that ship ES modules (.mjs): compiled as the preset compiles the rest.
  transform: { "\\.mjs$": jsTransform[1] },
  // Lucide's icons: its CommonJS build, which Node runs as is, not the ES build the preset's "react-native" condition picks.
  // That one is ~2,000 files, one per icon, behind a single import, each compiled by Babel the first time a test renders
  // a page: with no transform cache (CI), Expo Router's first render took 45 s on its own, and over a test's 60 s timeout
  // when the CI runner's workers did it at the same time (coaching.e2e, app.e2e).
  moduleNameMapper: { "^lucide-react-native$": require.resolve("lucide-react-native") },
  // jest-expo's own list, plus Expo Router's navigation core and the auth client, shipped untranspiled.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-svg|standard-navigation|better-auth|@better-auth|@better-fetch|better-call|nanostores|@noble|jose|defu|rou3|zod))",
  ],
};
