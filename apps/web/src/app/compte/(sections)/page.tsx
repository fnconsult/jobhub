import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

/** The titles' ids, which name their Cards. */
const PROFILES_TITLE_ID = "profiles-title";
const ARCHIVED_TITLE_ID = "archived-profiles-title";

/** Mon compte's Profiles Section, also shown at /compte itself (the first Section): the active Profiles, then the archived ones, each on a Card (#469). */
export default async function AccountProfilesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const [profiles, canAdd] = await Promise.all([getProfiles().list(candidate.id), getProfiles().canAddProfile(candidate.id)]);
  const active = profiles.filter((profile) => !profile.archived);
  const archived = profiles.filter((profile) => profile.archived);
  return (
    <>
      <Card title={t("profiles.title")} headingId={PROFILES_TITLE_ID}>
        <div className="stack">
          {profiles.length === 0 ? (
            <>
              <p>
                {t("profiles.none")} <EmptyStateHelp of="profiles" />
              </p>
              <div className="actions">
                <Link className={buttonClass({ variant: "primary" })} href={routes.newProfile}>
                  {t("profiles.create")}
                </Link>
              </div>
            </>
          ) : (
            <>
              {active.length > 0 ? <ProfileLinks profiles={active} /> : null}
              {canAdd ? (
                <div className="actions">
                  <Link className={buttonClass()} href={routes.newProfile}>
                    {t("profiles.add")}
                  </Link>
                </div>
              ) : (
                <Note>{t("profiles.quotaReached")}</Note>
              )}
            </>
          )}
        </div>
      </Card>
      {archived.length > 0 ? (
        <Card title={t("profiles.archivedTitle")} headingId={ARCHIVED_TITLE_ID}>
          <ProfileLinks profiles={archived} />
        </Card>
      ) : null}
    </>
  );
}

function ProfileLinks({ profiles }: { profiles: { id: string; name: string }[] }) {
  return (
    <ul className="account-links">
      {profiles.map((profile) => (
        <li key={profile.id}>
          <Link href={routes.profile(profile.id)}>{profile.name}</Link>
        </li>
      ))}
    </ul>
  );
}
