// The app's tests (ADR-0076): Jest with React Native Testing Library, on jest-expo's preset. The root's Vitest leaves
// apps/mobile to it (vitest.config.ts).
const preset = require("jest-expo/jest-preset");

const [jsTransform] = Object.entries(preset.transform).filter(([pattern]) => pattern === "\\.[jt]sx?$");

module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}", "<rootDir>/e2e/**/*.e2e.test.{ts,tsx}"],
  // Lucide's icons ship as ES modules (.mjs): compiled as the preset compiles the rest.
  transform: { "\\.mjs$": jsTransform[1] },
  // jest-expo's own list, plus Lucide's icons and Expo Router's navigation core, shipped untranspiled.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-svg|lucide-react-native|standard-navigation|better-auth|@better-auth|@better-fetch|better-call|nanostores|@noble|jose|defu|rou3|zod))",
  ],
};
