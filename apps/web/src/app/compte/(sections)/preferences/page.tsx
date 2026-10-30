import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { AccountSettings } from "@/components/AccountSettings";
import { TextSizeSlider } from "@/components/TextSizeControl";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

/** The Section's title's id, which names its Card. */
const PREFERENCES_TITLE_ID = "preferences-title";

/** Mon compte's Preferences Section: the Interface Language and the Text Size. */
export default async function AccountPreferencesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  return (
    <Card title={t("account.sections.preferences")} headingId={PREFERENCES_TITLE_ID}>
      <div className="stack">
        <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
        <TextSizeSlider />
      </div>
    </Card>
  );
}
