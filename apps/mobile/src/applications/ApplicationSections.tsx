import type { ApplicationResponse } from "@jobhub/shared/reads";
import { ExternalLink } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { useApplication } from "../api/reads";
import { ReadState } from "../screens/ReadState";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { applicationFormats, matchScoreInWords, siteOf } from "./application-formats";
import { CompanyDossier } from "./CompanyDossier";
import { EnrichedContacts } from "./EnrichedContacts";
import { Interviews } from "./Interviews";
import { Property } from "./Property";

/**
 * The Sections of an Application the app shows, in the web's order (ADR-0024, apps/web/src/routes.ts), each at the
 * web's address (`/candidatures/:id/<section>`): its Match Score, its Interviews, its Company Dossier, its Enriched
 * Contacts (on the Fiche only where the web shows them, `showsContacts`), its Job Offer. Its Tailored Documents are its
 * Results; the Coach Reviews, which no GET reads yet, stay on jobbbox.ai; the AI Coach's proposals are cards in the
 * conversation.
 */
export const APP_SECTIONS = ["correspondance", "entretiens", "dossier", "contacts", "offre"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

/** Whether `value` names one of the Sections the app shows. */
export const isAppSection = (value: string | undefined): value is AppSection => (APP_SECTIONS as readonly (string | undefined)[]).includes(value);

/**
 * One of an Application's Sections in the Work Pane, as the web app reads it (`GET /api/applications/:id`, or the
 * Section's own GET for the Company Dossier and the Enriched Contacts): read again after each change made there, so it
 * always shows what the web app holds.
 */
export function ApplicationSection({ applicationId, section }: { applicationId: string; section: AppSection }) {
  const { t } = useTranslation();
  const application = useApplication(applicationId);
  if (section === "dossier") return <CompanyDossier applicationId={applicationId} />;
  if (section === "contacts") return <EnrichedContacts applicationId={applicationId} />;
  return (
    <ReadState read={application} notFound={t("mobile.applications.notFound")}>
      {(read) => {
        if (section === "entretiens") return <Interviews application={read} />;
        if (section === "correspondance") return <MatchScore application={read} />;
        return <JobOffer application={read} />;
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
          label={t("jobOffer.sourceLink", { site: siteOf(jobOffer.url) })}
          icon={ExternalLink}
          look="secondary"
          onPress={() => void Linking.openURL(jobOffer.url!).catch(() => undefined)}
        />
      ) : null}
    </View>
  );
}
