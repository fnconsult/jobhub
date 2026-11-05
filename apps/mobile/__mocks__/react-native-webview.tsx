// A WebView in tests: its props kept for the test to drive as the page would (src/testing-device.ts), its address shown.
import { useEffect } from "react";
import { Text } from "react-native";
import { fakeWebView } from "../src/testing-device";

const show = (props: Record<string, unknown>) => void (fakeWebView.shown = props);
const hide = (props: Record<string, unknown>) => void (fakeWebView.shown === props && (fakeWebView.shown = null));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function WebView(props: Record<string, any>) {
  show(props);
  useEffect(() => () => hide(props), [props]);
  return <Text testID="web-view">{props.source?.uri}</Text>;
}
export default WebView;
