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
// Native views Jest has no binary for, drawn as a plain View with their props, for every test file.
jest.mock("react-native-webview", () => {
  const { createElement } = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  return { WebView: (props) => createElement(View, { testID: "webview", accessibilityLabel: props.accessibilityLabel }) };
});
