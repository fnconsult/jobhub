import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { getIdentityNames } from "@/candidate-identity/server";
import { IdentityForm } from "@/components/IdentityForm";
import { Card } from "@/design/Card";
import { getServerT } from "@/i18n/server";

/** The Section's title's id, which names its Card. */
const IDENTITY_TITLE_ID = "identity-title";

/** Mon compte's Identity Section (#918), the first listed: the Candidate's Given Name, Family Name and Preferred Name. */
export default async function AccountIdentityPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const t = await getServerT();
  const names = (await getIdentityNames().of(candidate.id)) ?? { givenName: null, familyName: null, preferredName: null };
  return (
    <Card title={t("account.sections.identity")} headingId={IDENTITY_TITLE_ID}>
      <IdentityForm names={names} />
    </Card>
  );
}
