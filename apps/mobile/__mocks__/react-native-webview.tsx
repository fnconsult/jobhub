// react-native-webview has no native view under Jest: a View stands in for it, carrying the WebView's props, so a test
// reads what it loads and plays what the page does (a link followed, a new window asked) through its callbacks (#689).
import { View } from "react-native";

export function WebView(props: Record<string, unknown>) {
  return <View testID="web-view" {...props} />;
}

export default WebView;
