import Link from "next/link";
import { getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { TextSizeControl } from "./TextSizeControl";

/**
 * The header of the signed-in Candidate's pages: the brand, the link to their
 * Applications, the Profile switcher and the Text Size control.
 */
export async function WorkspaceHeader({ candidateId, currentProfileId }: { candidateId: string; currentProfileId?: string }) {
  const t = await getServerT();
  return (
    <header className="page-header">
      <Link className="brand" href={routes.home}>
        {t("app.name")}
      </Link>
      <div className="page-nav">
        <Link href={routes.applications}>{t("nav.applications")}</Link>
        <ProfileSwitcher candidateId={candidateId} currentProfileId={currentProfileId} />
        <TextSizeControl />
      </div>
    </header>
  );
}

/** `aria-current` of the link to the Profile being shown. */
const CURRENT = "page";

/**
 * Moves between the Candidate's active Profiles (archived ones are left out),
 * and offers to add one while the Plan Quota allows. Shown once the Candidate
 * has a Profile.
 */
async function ProfileSwitcher({ candidateId, currentProfileId }: { candidateId: string; currentProfileId?: string | undefined }) {
  const t = await getServerT();
  const [all, canAdd] = await Promise.all([getProfiles().list(candidateId), getProfiles().canAddProfile(candidateId)]);
  if (all.length === 0) return null;
  const current = all.find((profile) => profile.id === currentProfileId);
  const active = all.filter((profile) => !profile.archived);
  return (
    <nav className="profile-switcher" aria-label={t("profileSwitcher.label")}>
      {/* Keyed by the current Profile so it opens closed again after switching. */}
      <details key={currentProfileId ?? ""}>
        <summary>{current ? t("profileSwitcher.current", { name: current.name }) : t("profileSwitcher.choose")}</summary>
        <ul>
          {active.map((profile) => (
            <li key={profile.id}>
              <Link href={routes.profile(profile.id)} aria-current={profile.id === currentProfileId ? CURRENT : undefined}>
                {profile.name}
              </Link>
            </li>
          ))}
          {canAdd ? (
            <li>
              <Link href={routes.newProfile}>{t("profiles.add")}</Link>
            </li>
          ) : null}
        </ul>
      </details>
    </nav>
  );
}
