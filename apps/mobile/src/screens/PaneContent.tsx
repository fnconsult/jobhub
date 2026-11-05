import type { ApplicationResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useApplication, useProfile, useTailoredDocuments } from "../api/reads";
import type { DocumentReader } from "../documents/document-reader";
import { TailoredDocuments } from "../documents/TailoredDocuments";
import { ProfileSummary } from "../profiles/ProfileSummary";
import type { ShellPage } from "../shell/Shell";
import { space } from "../theme/theme";
import { PanePlaceholder } from "./PanePlaceholder";
import { ReadState } from "./ReadState";

/** What the page's column shows: an object's Fiche, or Activité, by the page at `pathname`. */
export function PaneContent({ pathname, page, reader }: { pathname: string; page: ShellPage; reader: DocumentReader }) {
  const [, section, id] = pathname.split("/").map((part) => decodeURIComponent(part));
  if (section === "candidatures" && id && page.pane === "fiche") {
    return (
      <View style={{ gap: space[6] }}>
        <PanePlaceholder pane={page.pane} />
        <ApplicationDocuments applicationId={id} fallbackName={page.title} reader={reader} />
      </View>
    );
  }
  if (section === "profils" && id && page.pane === "fiche") return <ProfileFiche profileId={id} />;
  return <PanePlaceholder pane={page.pane} />;
}

/** A Profile's Fiche: the Profile as `GET /api/profiles/:id` reads it (#695). */
function ProfileFiche({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  return (
    <ReadState read={useProfile(profileId)} notFound={t("mobile.profiles.notFound")}>
      {(profile) => <ProfileSummary profile={profile} />}
    </ReadState>
  );
}

/** « Aéroline · Responsable qualité »: what an Application's documents are named for, its Job Offer. */
const applicationName = ({ jobOffer }: ApplicationResponse) => (jobOffer.employer ? `${jobOffer.employer} · ${jobOffer.title}` : jobOffer.title);

/**
 * An Application's Tailored Documents, as `GET /api/applications/:id/documents` reads them (#695), named for its Job
 * Offer (`GET /api/applications/:id`), or for the page's title while that is not read.
 */
function ApplicationDocuments({ applicationId, fallbackName, reader }: { applicationId: string; fallbackName: string; reader: DocumentReader }) {
  const { t } = useTranslation();
  const application = useApplication(applicationId).data;
  return (
    <ReadState read={useTailoredDocuments(applicationId)} notFound={t("mobile.documents.notFound")}>
      {(documents) => <TailoredDocuments documents={documents} about={application ? applicationName(application) : fallbackName} reader={reader} />}
    </ReadState>
  );
}
