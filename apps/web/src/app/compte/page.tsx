import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentIsAdministrator } from "@/admin/server";
import { getCurrentCandidate, linkedSignInProviders } from "@/auth/server";
import { AccountDataSection } from "@/components/AccountDataSection";
import { AccountSettings } from "@/components/AccountSettings";
import { CandidateLayout } from "@/components/CandidateLayout";
import { EuAiConsentForm } from "@/components/EuAiConsentForm";
import { FollowUpDelaysForm } from "@/components/FollowUpDelaysForm";
import { SignInMethods } from "@/components/SignInMethods";
import { signInButtons } from "@/sign-in-providers/policy";
import { currentSignInConfiguration } from "@/sign-in-providers/server";
import { MAX_FOLLOW_UP_DELAY } from "@/follow-ups";
import { getFollowUps } from "@/follow-ups/server";
import { currentHumanCoach } from "@/human-coaches/server";
import { getEuAiConsents } from "@/eu-ai-consent/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { getProfiles } from "@/profiles/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("account.title")} · ${t("app.name")}` };
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  const t = await getServerT();
  const [profiles, canAdd, followUpDelays, euAiConsentGivenAt, locale, isAdministrator, linkedIds, { error }] = await Promise.all([
    getProfiles().list(candidate.id),
    getProfiles().canAddProfile(candidate.id),
    getFollowUps().delays(candidate.id),
    getEuAiConsents().givenAt(candidate.id),
    getRequestLocale(),
    currentIsAdministrator(),
    linkedSignInProviders(),
    searchParams,
  ]);
  // The providers this person may sign in with: those shown to Candidates, and an Administrator's own.
  const configuration = currentSignInConfiguration();
  const usable = [...signInButtons(configuration, "candidates"), ...(isAdministrator ? signInButtons(configuration, "administrators") : [])].filter(
    (provider, index, all) => all.findIndex((other) => other.id === provider.id) === index,
  );
  const active = profiles.filter((profile) => !profile.archived);
  const archived = profiles.filter((profile) => profile.archived);
  return (
    <CandidateLayout candidateId={candidate.id}>
      <h1>{t("account.title")}</h1>
      <dl>
        <dt>{t("account.email")}</dt>
        <dd>{candidate.email}</dd>
      </dl>
      <section className="stack" aria-labelledby="profiles-title">
        <h2 id="profiles-title">{t("profiles.title")}</h2>
        {profiles.length === 0 ? (
          <>
            <p>{t("profiles.none")}</p>
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
      <FollowUpDelaysForm initial={followUpDelays} max={MAX_FOLLOW_UP_DELAY} />
      <EuAiConsentForm givenAt={euAiConsentGivenAt} locale={locale} />
      <nav className="page-nav">
        <Link className="button" href={routes.subscription}>
          {t("account.plan")}
        </Link>
        <Link className="button" href={routes.coaching}>
          {t("account.humanCoaches")}
        </Link>
        {(await currentHumanCoach()) ? (
          <Link className="button" href={routes.coachSpace}>
            {t("account.coachSpace")}
          </Link>
        ) : null}
        {isAdministrator ? (
          <Link className="button" href={routes.admin}>
            {t("account.admin")}
          </Link>
        ) : null}
      </nav>
      <SignInMethods
        linked={usable.filter((provider) => linkedIds.includes(provider.id))}
        linkable={usable.filter((provider) => !linkedIds.includes(provider.id))}
        failed={Boolean(error)}
      />
      <AccountSettings interfaceLanguage={candidate.interfaceLanguage} />
      <AccountDataSection />
    </CandidateLayout>
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
