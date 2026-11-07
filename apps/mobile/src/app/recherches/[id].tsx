import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppText } from "../../ui/AppText";
import { CoachConversation } from "../../coach/CoachConversation";
import type { SubjectRef } from "../../coach/coach-reply";
import { JobSearchPage } from "../../job-searches/JobSearchPage";
import { paths } from "../../navigation/pages";

const JOB_SEARCH: SubjectRef["kind"] = "job_search";

/**
 * A Job Search's page (`/recherches/:id`, #692), where « Lancer une recherche » lands (#699): its card and Job Offers
 * lead the page, its Coach Conversation, whose Subject it is (ADR-0070), following it with its box at the foot.
 */
export default function JobSearch() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <CoachConversation
      key={id}
      conversationId={null}
      subject={{ kind: JOB_SEARCH, id }}
      route={paths.jobSearch(id)}
      lead={<JobSearchPage id={id} />}
      introduction={<AppText>{t("mobile.jobSearches.introduction")}</AppText>}
    />
  );
}
