// The WebView, a native view Jest has no binary for: a plain View named by its title. A test that needs what it loads
// mocks it with its own factory (e2e/profiles.e2e.test.tsx).
import { View } from "react-native";

export const WebView = ({ accessibilityLabel }: { accessibilityLabel?: string }) => <View testID="webview" accessibilityLabel={accessibilityLabel} />;
