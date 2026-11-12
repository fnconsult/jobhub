import { useLocalSearchParams, usePathname } from "expo-router";
import { coachSpaceV2Only } from "../../../navigation/coach-space-v2";
import { SessionWebPage } from "../../../web-pages/WebPageScreen";
/** Keep the email-bound token when a universal link opens the invitation in the native app. */
function InvitationPage() {
  const path = usePathname(),
    { token } = useLocalSearchParams<{ token?: string }>();
  return <SessionWebPage path={`${path}?token=${encodeURIComponent(typeof token === "string" ? token : "")}`} />;
}
export default coachSpaceV2Only(InvitationPage);
