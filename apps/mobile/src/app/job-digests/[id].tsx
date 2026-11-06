import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppText } from "../../ui/AppText";
import { CoachConversation } from "../../coach/CoachConversation";
import type { SubjectRef } from "../../coach/coach-reply";
import { JobDigestPage } from "../../job-searches/JobDigestPage";
import { paths } from "../../navigation/pages";

const JOB_DIGEST: SubjectRef["kind"] = "job_digest";

/** A Job Digest sent (`/job-digests/:id`, #692): its Job Offers lead the page, its Coach Conversation following it (ADR-0070). */
export default function JobDigest() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <CoachConversation
      key={id}
      conversationId={null}
      subject={{ kind: JOB_DIGEST, id }}
      route={paths.jobDigest(id)}
      lead={<JobDigestPage id={id} />}
      introduction={<AppText>{t("mobile.jobDigests.introduction")}</AppText>}
    />
  );
}
