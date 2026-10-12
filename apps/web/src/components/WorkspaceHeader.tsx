import Link from "next/link";
import { getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";
import { ProfileSwitcherMenu } from "./ProfileSwitcherMenu";
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

/**
 * Moves between the Candidate's active Profiles (archived ones are left out),
 * and offers to add one while the Plan Quota allows. Shown once the Candidate
 * has a Profile.
 */
async function ProfileSwitcher({ candidateId, currentProfileId }: { candidateId: string; currentProfileId?: string | undefined }) {
  const [all, canAdd] = await Promise.all([getProfiles().list(candidateId), getProfiles().canAddProfile(candidateId)]);
  if (all.length === 0) return null;
  const active = all.filter((profile) => !profile.archived).map(({ id, name }) => ({ id, name }));
  // An archived Profile's page still names it on the button, though the menu leaves it out.
  const current = all.find((profile) => profile.id === currentProfileId);
  return (
    <ProfileSwitcherMenu
      // Keyed by the current Profile so it opens closed again after switching.
      key={currentProfileId ?? ""}
      profiles={active}
      current={current ? { id: current.id, name: current.name } : undefined}
      canAdd={canAdd}
    />
  );
}
