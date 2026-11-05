/* global jest */
// The app as a build of it runs (a bare build, app.json's config), which Jest's Expo Constants is not: its scheme names
// the app's origin (@better-auth/expo, src/session).
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const Constants = actual.default ?? actual;
  const expoConfig = { ...Constants.expoConfig, ...require("./app.json").expo };
  return { __esModule: true, ...actual, default: new Proxy(Constants, { get: (target, key) => (key === "expoConfig" ? expoConfig : key === "executionEnvironment" ? "bare" : target[key]) }) };
});
// AsyncStorage has no native module under Jest: its own in-memory mock stands in for the device's storage (#701).
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
