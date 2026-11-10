import { useLocalSearchParams, usePathname } from "expo-router";
import { SessionWebPage } from "../../../web-pages/WebPageScreen";
/** Keep the email-bound token when a universal link opens the invitation in the native app. */
export default function InvitationPage() {
  const path = usePathname(),
    { token } = useLocalSearchParams<{ token?: string }>();
  return <SessionWebPage path={`${path}?token=${encodeURIComponent(typeof token === "string" ? token : "")}`} />;
}
