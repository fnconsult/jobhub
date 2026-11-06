import type { ApplicationResponse } from "@jobhub/shared/reads";
import { ChevronRight, ExternalLink } from "lucide-react-native";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Pressable, View } from "react-native";
import { useApplication, useEnrichedContacts, useTailoredDocuments } from "../api/reads";
import { ActivityPane } from "../coach/ActivityPane";
import type { DocumentReader } from "../documents/document-reader";
import { TailoredDocuments } from "../documents/TailoredDocuments";
import { ReadState } from "../screens/ReadState";
import { useWorkPane } from "../shell/Shell";
import { radius, space, TARGET, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { usePointerHover } from "../ui/pointer";
import { applicationFormats, matchScoreInWords, siteOf } from "./application-formats";
import { ApplicationSection, APP_SECTIONS, type AppSection } from "./ApplicationSections";
import { showsContacts } from "./EnrichedContacts";
import { Property } from "./Property";
import { StatusField } from "./StatusField";

/**
 * An Application's Fiche in the app (#691, ADR-0070): what `GET /api/applications/:id` reads of it, as the web's Fiche
 * shows it. Its card (its status, changed here as on the web; when it was saved, its Match Score, its Profile, its Job
 * Offer's site, whether that offer is expired or Reported Unavailable), its Sections, each opened in the Work Pane over
 * the Fiche (beside it from 64rem), its Activity, and its Results, the Tailored Documents (#695). An Archived
 * Application reads the same.
 */
export function ApplicationFiche({ applicationId, reader }: { applicationId: string; reader: DocumentReader }) {
  const { t } = useTranslation();
  return (
    <ReadState read={useApplication(applicationId)} notFound={t("mobile.applications.notFound")}>
      {(application) => (
        <View style={{ gap: space[6] }}>
          <ApplicationCard application={application} />
          <Group title={t("fiche.groups.sections")}>
            <Sections application={application} />
          </Group>
          <Group title={t("fiche.groups.activity")}>
            <ActivityPane />
          </Group>
          <Group title={t("fiche.groups.results")}>
            <Results application={application} reader={reader} />
          </Group>
        </View>
      )}
    </ReadState>
  );
}

/** One of the Fiche's groups: its heading, then what it holds. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h3" heading>
        {title}
      </AppText>
      {children}
    </View>
  );
}

/** The Section the card's Match Score leads to, its breakdown. */
const MATCH_SCORE: AppSection = "correspondance";

/** The Application at a glance, first in its Fiche: its Job Offer, then its properties, its status changed in place. */
function ApplicationCard({ application }: { application: ApplicationResponse }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const formats = applicationFormats(i18n.language);
  const { jobOffer } = application;
  const facts = [jobOffer.employer, jobOffer.location].filter(Boolean).join(" · ");
  const open = useOpenSection(application.id);
  const openMatchScore = () => open(MATCH_SCORE);
  return (
    <View style={{ gap: space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <View aria-hidden style={{ width: TARGET, height: TARGET, borderRadius: radius.md, backgroundColor: colors.hover, alignItems: "center", justifyContent: "center" }}>
          <AppText weight="bold">{(jobOffer.employer ?? jobOffer.title).trim().charAt(0).toUpperCase()}</AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText weight="semiBold">{jobOffer.title}</AppText>
          {facts ? <AppText tone="secondary">{facts}</AppText> : null}
        </View>
      </View>
      <StatusField application={application} />
      <Property label={t("application.savedOnLabel")}>
        <AppText>{formats.date(application.createdAt)}</AppText>
      </Property>
      <Property label={t("application.matchLabel")}>
        <AppText>{matchScoreInWords(application.matchScore, t)}</AppText>
        <Control label={t("application.matchDetail")} onPress={openMatchScore} />
      </Property>
      <Property label={t("application.profileLabel")}>
        <AppText>{application.profile.name}</AppText>
      </Property>
      {jobOffer.url ? (
        <Property label={t("application.offerLabel")}>
          <Control label={t("jobOffer.sourceLink", { site: siteOf(jobOffer.url) })} icon={ExternalLink} onPress={() => void Linking.openURL(jobOffer.url!).catch(() => undefined)} />
        </Property>
      ) : null}
      {jobOffer.expiredAt ? (
        <Notice>
          <AppText weight="semiBold">{t("jobOffer.expired", { date: formats.date(jobOffer.expiredAt) })}</AppText>
          <AppText>{t("application.expiredNotice")}</AppText>
        </Notice>
      ) : null}
      {application.reportedUnavailableAt ? (
        <Notice>
          <AppText weight="semiBold">{`${t("applications.expired")} · ${t("applications.reportedByYou")}`}</AppText>
          <AppText>{t("application.reportedNotice", { date: formats.date(application.reportedUnavailableAt) })}</AppText>
        </Notice>
      ) : null}
    </View>
  );
}

function Notice({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View role="status" style={{ gap: space[1], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.warn }}>
      {children}
    </View>
  );
}

/** Opens one of the Application's Sections in the Work Pane, titled as the web titles it. */
function useOpenSection(applicationId: string) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  return (section: AppSection) => workPane.open({ title: t(`application.sections.${section}`), content: <ApplicationSection applicationId={applicationId} section={section} /> });
}

/**
 * The Sections the app shows, in the web's order (ADR-0024), each to open in the Work Pane; « Contacts » only once the
 * web app says it shows them (a contact-data provider on, or some found).
 */
function Sections({ application }: { application: ApplicationResponse }) {
  const { t } = useTranslation();
  const open = useOpenSection(application.id);
  const contacts = useEnrichedContacts(application.id).data;
  const shown = APP_SECTIONS.filter((section) => section !== "contacts" || (contacts !== undefined && showsContacts(contacts)));
  return (
    <View style={{ gap: space[2] }}>
      {shown.map((section) => (
        <FicheLink key={section} label={t(`application.sections.${section}`)} onPress={() => open(section)} />
      ))}
      <AppText variant="meta" tone="meta">
        {t("mobile.applications.readOnlySections")}
      </AppText>
    </View>
  );
}

/** A line of the Fiche that opens something in the Work Pane: its words, an arrow after them. */
function FicheLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { hovered, hoverProps } = usePointerHover();
  return (
    <Pressable
      role="button"
      aria-label={label}
      onPress={onPress}
      {...hoverProps}
      style={({ pressed }) => ({
        minHeight: TARGET,
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        paddingHorizontal: space[3],
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed || hovered ? colors.hover : "transparent",
      })}
    >
      <View style={{ flex: 1 }}>
        <AppText weight="semiBold">{label}</AppText>
      </View>
      <ChevronRight color={colors.secondary} size={20} aria-hidden />
    </Pressable>
  );
}

/** « Aéroline · Responsable qualité »: what an Application's documents are named for, its Job Offer. */
const applicationName = ({ jobOffer }: ApplicationResponse) => (jobOffer.employer ? `${jobOffer.employer} · ${jobOffer.title}` : jobOffer.title);

/**
 * The Application's Results: its Tailored Documents, as `GET /api/applications/:id/documents` reads them (#695), to view,
 * share and download; they change on jobbbox.ai.
 */
function Results({ application, reader }: { application: ApplicationResponse; reader: DocumentReader }) {
  const { t } = useTranslation();
  return (
    <ReadState read={useTailoredDocuments(application.id)} notFound={t("mobile.documents.notFound")}>
      {(documents) => <TailoredDocuments applicationId={application.id} documents={documents} about={applicationName(application)} reader={reader} />}
    </ReadState>
  );
}
