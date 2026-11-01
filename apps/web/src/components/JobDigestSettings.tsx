import Link from "next/link";
import { JobDigestControls } from "@/components/JobDigestControls";
import type { getServerT } from "@/i18n/server";
import type { JobDigestSettings as Settings } from "@/job-digests";
import { routes } from "@/routes";

type T = Awaited<ReturnType<typeof getServerT>>;

const formatDate = (date: Date, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "Europe/Paris" }).format(date);

/** One Profile's Job Digest on the Job Digests page: its frequency, the way to change it, and the latest Job Digests sent. */
export function JobDigestSettings({ profile, jobDigest, locale, t }: { profile: { id: string; name: string }; jobDigest: Settings; locale: string; t: T }) {
  const titleId = `job-digest-${profile.id}`;
  return (
    <section className="section" id={titleId} aria-labelledby={`${titleId}-title`}>
      <div className="section-head">
        <h2 id={`${titleId}-title`}>{profile.name}</h2>
      </div>
      <JobDigestFrequency profileId={profile.id} jobDigest={jobDigest} t={t} />
      {jobDigest.digests.length > 0 ? (
        <>
          <h3>{t("jobDigest.latestTitle")}</h3>
          <ul className="rows">
            {jobDigest.digests.map((digest) => (
              <li key={digest.id} className="row">
                <Link className="row-title" href={routes.jobDigest(digest.id)}>
                  {t("jobDigest.digestLink", { date: formatDate(digest.sentAt, locale), count: digest.count })}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/**
 * How often one Profile's Job Digest is sent, and the way to opt in, change it or opt out: on the Job Digests page, and
 * on its menu's card under « Conversation au centre » (#606).
 */
export function JobDigestFrequency({ profileId, jobDigest, t }: { profileId: string; jobDigest: Settings; t: T }) {
  return (
    <>
      {jobDigest.planFrequency !== "none" ? <p>{t(`jobDigest.frequency.${jobDigest.planFrequency}`)}</p> : null}
      {jobDigest.subscribed ? (
        <>
          <p className="notice" role="status">
            {t("jobDigest.subscribed")}
          </p>
          {jobDigest.frequency !== "none" ? <p>{t(`jobDigest.schedule.${jobDigest.frequency}`)}</p> : null}
          {jobDigest.chosenFrequency !== jobDigest.frequency ? <p>{t("jobDigest.cappedToPlan")}</p> : null}
        </>
      ) : null}
      <JobDigestControls
        key={profileId}
        profileId={profileId}
        subscribed={jobDigest.subscribed}
        chosenFrequency={jobDigest.chosenFrequency}
        planFrequency={jobDigest.planFrequency}
      />
    </>
  );
}
