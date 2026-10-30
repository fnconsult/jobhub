import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AccountSettings } from "@/components/AccountSettings";
import { TextSizeSlider } from "@/components/TextSizeControl";
import { ThemeChoice } from "@/components/ThemeChoice";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";

/** The Section's title's id, which names its Card. */
const PREFERENCES_TITLE_ID = "preferences-title";

/** Mon compte's Preferences Section: the Interface Language, the theme (#473) and the Text Size. */
export default async function AccountPreferencesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const t = await getServerT();
  return (
    <Card title={t("account.sections.preferences")} headingId={PREFERENCES_TITLE_ID}>
      <div className="stack">
        <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
        <ThemeChoice />
        <TextSizeSlider />
      </div>
    </Card>
  );
}
