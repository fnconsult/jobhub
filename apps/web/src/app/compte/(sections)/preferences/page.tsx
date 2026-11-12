import { coachSpaceV2On } from "@/coach-space-v2/server";
import { TimeZoneForm } from "@/coaching-time/TimeZoneForm";
import { getCoachingTimeZones } from "@/coaching-time/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getCoachProposalsDisplays } from "@/coach-proposals-display/server";
import { AccountSettings } from "@/components/AccountSettings";
import { CoachProposalsDisplayChoice } from "@/components/CoachProposalsDisplayChoice";
import { NouveautesEmailForm } from "@/components/NouveautesEmailForm";
import { TextSizeSlider } from "@/components/TextSizeControl";
import { ThemeChoice } from "@/components/ThemeChoice";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";
import { getNouveautesEmails } from "@/nouveautes-email/server";

/** The Section's title's id, which names its Card. */
const PREFERENCES_TITLE_ID = "preferences-title";

/**
 * Mon compte's Preferences Section: the Interface Language, the theme (#473), the Text Size, the Nouveautés email (#566)
 * and « Propositions du coach » (#717).
 */
export default async function AccountPreferencesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const t = await getServerT();
  const [nouveautesEmail, coachProposalsDisplay] = await Promise.all([getNouveautesEmails().setting(candidate.id), getCoachProposalsDisplays().of(candidate.id)]);
  // The coaching time zone is part of « Espace coach v2 » (ADR-0106): off, not offered, as before it.
  const coachSpaceV2 = coachSpaceV2On();
  const timeZone = coachSpaceV2 ? await getCoachingTimeZones().candidate(candidate.id) : null;
  return (
    <Card title={t("account.sections.preferences")} headingId={PREFERENCES_TITLE_ID}>
      <div className="stack">
        <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
        {coachSpaceV2 ? <TimeZoneForm value={timeZone} /> : null}
        <ThemeChoice />
        <TextSizeSlider />
        <NouveautesEmailForm subscribedAt={nouveautesEmail.subscribedAt?.toISOString() ?? null} />
        <CoachProposalsDisplayChoice display={coachProposalsDisplay} />
      </div>
    </Card>
  );
}
