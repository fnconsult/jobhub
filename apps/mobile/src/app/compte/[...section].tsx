import { usePathname } from "expo-router";
import { View } from "react-native";
import { paths } from "../../navigation/pages";
import { PushSettingsNote } from "../../push/PushNotifications";
import { WebPageScreen } from "../../web-pages/WebPageScreen";

/**
 * The web app's page at this address, inside the app (#689, ADR-0076). Rappels has, above it, how to turn this device's
 * notifications on when refused (#699): the web page knows the account's switches, not the device's permission.
 */
export default function AccountSection() {
  const pathname = usePathname();
  if (pathname !== paths.accountReminders) return <WebPageScreen />;
  return (
    <View style={{ flex: 1 }}>
      <PushSettingsNote />
      <WebPageScreen />
    </View>
  );
}
