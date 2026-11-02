import { JobDigestSettings } from "@/components/JobDigestSettings";
import { InWorkPane } from "@/components/WorkPane";
import type { AddressedKind } from "@/components/work-pane";
import { getJobDigests } from "@/job-digests/server";
import { getProfiles } from "@/profiles/server";
import { routes, type JobDigestSection } from "@/routes";
import { loadJobDigestPage, type Params } from "../job-digest-page";

/** What it is in the Work Pane. */
const SECTION: AddressedKind = "section";
const SETTINGS: JobDigestSection = "reglages";

/**
 * The settings of the Job Digest of the Profile this one was sent for (#605): how often, changed in place, and the latest
 * ones sent; in the Work Pane beside its conversation. An archived Profile gets none, until it is restored. Without
 * « Conversation au centre », they are on the Job Digests page.
 */
export default async function JobDigestSettingsPage({ params }: Params) {
  const { candidateId, jobDigest, t, locale } = await loadJobDigestPage((await params).id);
  const { profile } = jobDigest;
  const [settings, current] = await Promise.all([getJobDigests().settings(candidateId, profile.id), getProfiles().get(candidateId, profile.id)]);
  return (
    <InWorkPane kind={SECTION} title={t("jobDigest.page.settings")} href={routes.jobDigestSection(jobDigest.id, SETTINGS)} back={routes.jobDigest(jobDigest.id)}>
      <p>{t("jobDigest.hint")}</p>
      {current?.archived ? <p className="notice">{t("jobDigest.page.archived")}</p> : settings ? <JobDigestSettings profile={profile} jobDigest={settings} locale={locale} t={t} /> : null}
    </InWorkPane>
  );
}
