import { View } from "react-native";
import type { DocumentReader } from "../documents/document-reader";
import { TailoredDocuments } from "../documents/TailoredDocuments";
import { ProfileSummary } from "../profiles/ProfileSummary";
import { SAMPLE_APPLICATIONS, SAMPLE_PROFILES, SAMPLE_TAILORED_DOCUMENTS } from "../sample-data";
import type { ShellPage } from "../shell/Shell";
import { space } from "../theme/theme";
import { PanePlaceholder } from "./PanePlaceholder";

/** What the page's column shows: an object's Fiche, or Activité, by the page at `pathname`. */
export function PaneContent({ pathname, page, reader }: { pathname: string; page: ShellPage; reader: DocumentReader }) {
  const [, section, id] = pathname.split("/").map((part) => decodeURIComponent(part));
  if (section === "candidatures" && id && page.pane === "fiche") {
    const application = SAMPLE_APPLICATIONS.find((candidate) => candidate.id === id);
    const documents = SAMPLE_TAILORED_DOCUMENTS[id];
    return (
      <View style={{ gap: space[6] }}>
        <PanePlaceholder pane={page.pane} />
        {application && documents ? <TailoredDocuments documents={documents} about={application.title} reader={reader} /> : null}
      </View>
    );
  }
  if (section === "profils" && id && page.pane === "fiche") {
    const profile = SAMPLE_PROFILES.find((candidate) => candidate.id === id);
    if (profile) return <ProfileSummary profile={profile} />;
  }
  return <PanePlaceholder pane={page.pane} />;
}
