import Link from "next/link";
import type { ReactNode } from "react";
import { ObjectConversation } from "@/components/ObjectConversation";
import { jobDigestFicheLinks } from "@/fiches";
import { routes } from "@/routes";
import type { JobDigestPageData } from "./job-digest-page";

const SUGGESTIONS = ["bestOffers", "criteria"] as const;
/** The Subject of a Job Digest's conversation (ADR-0070). */
const JOB_DIGEST = "job_digest";
const TIME_ZONE = "Europe/Paris";

/**
 * A Job Digest's page under « Conversation au centre » (#605, ADR-0070): its Coach Conversation, whose Subject it is,
 * with its Introduction and suggestions until its first message; and the Fiche beside it: the Job Digest's card (its
 * Profile, when it was sent, how many Job Offers it brought), its Job Offers and its settings as Sections, and each Job
 * Offer, with its Match Score, as a Result, opened in the Work Pane at its own address (`children`).
 */
export function JobDigestConversation({ data, children }: { data: JobDigestPageData; children: ReactNode }) {
  const { candidateId, jobDigest, t, locale, aiActivity, inView } = data;
  const { profile } = jobDigest;
  const sentOn = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: TIME_ZONE }).format(jobDigest.sentAt);
  return (
    <ObjectConversation
      candidateId={candidateId}
      subject={{ kind: JOB_DIGEST, id: jobDigest.id }}
      inView={inView}
      title={t("jobDigest.page.title", { profile: profile.name })}
      currentProfileId={profile.id}
      aiActivity={aiActivity}
      fiche={{
        card: (
          <dl className="props">
            <div className="prop">
              <dt>{t("jobDigest.page.profileLabel")}</dt>
              <dd>
                <Link href={routes.profile(profile.id)}>{profile.name}</Link>
              </dd>
            </div>
            <div className="prop">
              <dt>{t("jobDigest.page.sentOnLabel")}</dt>
              <dd>{sentOn}</dd>
            </div>
            <div className="prop">
              <dt>{t("jobDigest.page.offersLabel")}</dt>
              <dd>{jobDigest.results.length}</dd>
            </div>
          </dl>
        ),
        ...jobDigestFicheLinks(jobDigest, t),
      }}
      introduction={<p>{t("jobDigest.conversation.introduction", { date: sentOn, profile: profile.name })}</p>}
      suggestions={SUGGESTIONS.map((suggestion) => ({
        label: t(`jobDigest.conversation.suggestions.${suggestion}.label`),
        message: t(`jobDigest.conversation.suggestions.${suggestion}.message`),
      }))}
    >
      {children}
    </ObjectConversation>
  );
}
