import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AccountSettings } from "@/components/AccountSettings";
import { NouveautesEmailForm } from "@/components/NouveautesEmailForm";
import { TextSizeSlider } from "@/components/TextSizeControl";
import { ThemeChoice } from "@/components/ThemeChoice";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";
import { getNouveautesEmails } from "@/nouveautes-email/server";

/** The Section's title's id, which names its Card. */
const PREFERENCES_TITLE_ID = "preferences-title";

/** Mon compte's Preferences Section: the Interface Language, the theme (#473), the Text Size and the Nouveautés email (#566). */
export default async function AccountPreferencesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const t = await getServerT();
  const nouveautesEmail = await getNouveautesEmails().setting(candidate.id);
  return (
    <Card title={t("account.sections.preferences")} headingId={PREFERENCES_TITLE_ID}>
      <div className="stack">
        <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
        <ThemeChoice />
        <TextSizeSlider />
        <NouveautesEmailForm subscribedAt={nouveautesEmail.subscribedAt?.toISOString() ?? null} />
      </div>
    </Card>
  );
}
