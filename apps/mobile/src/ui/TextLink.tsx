import { Linking, Pressable } from "react-native";
import { TARGET, useTheme } from "../theme/theme";
import { AppText } from "./AppText";

/**
 * A link out of the app, `label` in the accent colour: an address on the web in the system's browser, an e-mail
 * (`mailto:`) or a phone number (`tel:`) in the device's own app.
 */
export function TextLink({ label, url }: { label: string; url: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      role="link"
      aria-label={label}
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      style={({ pressed }) => ({ minHeight: TARGET, justifyContent: "center", backgroundColor: pressed ? colors.hover : "transparent" })}
    >
      <AppText tone="accent">{label}</AppText>
    </Pressable>
  );
}
