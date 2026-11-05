import type { ApplicationResponse } from "@jobhub/shared/reads";
import { ExternalLink } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { useApplication } from "../api/reads";
import { ReadState } from "../screens/ReadState";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { applicationFormats, matchScoreInWords } from "./application-formats";
import { Interviews } from "./Interviews";
import { Property } from "./Property";

/**
 * The Sections of an Application the app shows, in the web's order (ADR-0024, apps/web/src/routes.ts), each at the
 * web's address (`/candidatures/:id/<section>`): its Match Score, its Interviews, its Job Offer. The others, which
 * `GET /api/applications/:id` does not read (the Company Dossier, the Enriched Contacts, the Coach Reviews), stay on
 * jobbbox.ai; the AI Coach's proposals are cards in the conversation.
 */
export const APP_SECTIONS = ["correspondance", "entretiens", "offre"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

/** Whether `value` names one of the Sections the app shows. */
export const isAppSection = (value: string | undefined): value is AppSection => (APP_SECTIONS as readonly (string | undefined)[]).includes(value);

/**
 * One of an Application's Sections in the Work Pane, as `GET /api/applications/:id` reads it: read again after each
 * change made there, so it always shows what the web app holds.
 */
export function ApplicationSection({ applicationId, section }: { applicationId: string; section: AppSection }) {
  const { t } = useTranslation();
  return (
    <ReadState read={useApplication(applicationId)} notFound={t("mobile.applications.notFound")}>
      {(application) => {
        if (section === "entretiens") return <Interviews application={application} />;
        if (section === "correspondance") return <MatchScore application={application} />;
        return <JobOffer application={application} />;
      }}
    </ReadState>
  );
}

/** Correspondance: the Match Score and the Profile it measures, read only. */
function MatchScore({ application }: { application: ApplicationResponse }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h3" heading>
        {t("matchScore.title")}
      </AppText>
      <AppText weight="semiBold">{matchScoreInWords(application.matchScore, t)}</AppText>
      <AppText>{t("matchScore.intro", { profile: application.profile.name })}</AppText>
      {application.matchScore === null ? <AppText tone="secondary">{t("matchScore.notComputableHint")}</AppText> : null}
    </View>
  );
}

/** L'offre: the Job Offer's facts as the app reads them, and its site, read only. */
function JobOffer({ application }: { application: ApplicationResponse }) {
  const { t, i18n } = useTranslation();
  const formats = applicationFormats(i18n.language);
  const { jobOffer } = application;
  const notSpecified = t("profile.notSpecified");
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h3" heading>
        {jobOffer.title}
      </AppText>
      <Property label={t("jobOffer.employer")}>
        <AppText>{jobOffer.employer ?? notSpecified}</AppText>
      </Property>
      <Property label={t("jobOffer.location")}>
        <AppText>{jobOffer.location ?? notSpecified}</AppText>
      </Property>
      <Property label={t("jobOffer.postedAt")}>
        <AppText>{jobOffer.postedAt ? formats.date(jobOffer.postedAt) : t("jobOffer.dateUnknown")}</AppText>
      </Property>
      {jobOffer.expiredAt ? <AppText tone="warn">{t("jobOffer.expired", { date: formats.date(jobOffer.expiredAt) })}</AppText> : null}
      {jobOffer.url ? (
        <Control
          label={t("jobOffer.sourceLink", { site: new URL(jobOffer.url).hostname.replace(/^www\./, "") })}
          icon={ExternalLink}
          look="secondary"
          onPress={() => void Linking.openURL(jobOffer.url!).catch(() => undefined)}
        />
      ) : null}
    </View>
  );
}
