// The app's tests (ADR-0076): Jest with React Native Testing Library, on jest-expo's preset. The root's Vitest leaves
// apps/mobile to it (vitest.config.ts).
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  // jest-expo's own list, plus Lucide's icons, shipped untranspiled.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-svg|lucide-react-native))",
  ],
};
