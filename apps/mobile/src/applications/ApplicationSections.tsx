import type { ApplicationResponse } from "@jobhub/shared/reads";
import type { TFunction } from "i18next";
import { ExternalLink } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { FRENCH_TIME_ZONE } from "../agenda/french-time";
import { useApplication } from "../api/reads";
import { ReadState } from "../screens/ReadState";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
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

/** How an Application's page writes its dates, in the Interface Language, in French time (ADR-0028), as the web's. */
export function applicationFormats(locale: string) {
  const zone = { timeZone: FRENCH_TIME_ZONE };
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", ...zone });
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full", ...zone });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", ...zone });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short", ...zone });
  const changedAt = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", ...zone });
  return {
    /** « 28 octobre 2026 » */
    date: (instant: string) => date.format(new Date(instant)),
    /** « jeudi 12 novembre 2026 » */
    fullDate: (instant: string) => fullDate.format(new Date(instant)),
    /** « 14:30 » */
    time: (instant: string) => time.format(new Date(instant)),
    /** « jeudi 12 novembre 2026 à 14:30 » */
    dateTime: (instant: string) => dateTime.format(new Date(instant)),
    /** « 3 novembre 2026 à 09:00 » */
    changedAt: (instant: string) => changedAt.format(new Date(instant)),
  };
}
export type ApplicationFormats = ReturnType<typeof applicationFormats>;

/** « 82 / 100 », or « Non calculable »: never 0 / 100 for a Match Score with nothing to compare (#94). */
export const matchScoreInWords = (matchScore: number | null, t: TFunction) => (matchScore === null ? t("matchScore.notComputable") : t("matchScore.score", { score: matchScore }));

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
