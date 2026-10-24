import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { EmptyStateHelp } from "@/components/HelpTerm";
import { getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

/** Mon compte's Profiles Section, also shown at /compte itself (the first Section). */
export default async function AccountProfilesPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const [profiles, canAdd] = await Promise.all([getProfiles().list(candidate.id), getProfiles().canAddProfile(candidate.id)]);
  const active = profiles.filter((profile) => !profile.archived);
  const archived = profiles.filter((profile) => profile.archived);
  return (
    <>
      <section className="stack" aria-labelledby="profiles-title">
        <h2 id="profiles-title">{t("profiles.title")}</h2>
        {profiles.length === 0 ? (
          <>
            <p>
              {t("profiles.none")} <EmptyStateHelp of="profiles" />
            </p>
            <Link className="button button-primary" href={routes.newProfile}>
              {t("profiles.create")}
            </Link>
          </>
        ) : (
          <>
            {active.length > 0 ? <ProfileLinks profiles={active} /> : null}
            {canAdd ? (
              <Link className="button" href={routes.newProfile}>
                {t("profiles.add")}
              </Link>
            ) : (
              <p className="notice">{t("profiles.quotaReached")}</p>
            )}
          </>
        )}
      </section>
      {archived.length > 0 ? (
        <section className="stack" aria-labelledby="archived-profiles-title">
          <h2 id="archived-profiles-title">{t("profiles.archivedTitle")}</h2>
          <ProfileLinks profiles={archived} />
        </section>
      ) : null}
    </>
  );
}

function ProfileLinks({ profiles }: { profiles: { id: string; name: string }[] }) {
  return (
    <ul>
      {profiles.map((profile) => (
        <li key={profile.id}>
          <Link href={routes.profile(profile.id)}>{profile.name}</Link>
        </li>
      ))}
    </ul>
  );
}
