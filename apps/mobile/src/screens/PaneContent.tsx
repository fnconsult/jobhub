import { useTranslation } from "react-i18next";
import { useProfile } from "../api/reads";
import { ApplicationFiche } from "../applications/ApplicationFiche";
import type { DocumentReader } from "../documents/document-reader";
import { ProfileSummary } from "../profiles/ProfileSummary";
import type { ShellPage } from "../shell/Shell";
import { ReadState } from "./ReadState";

/** What an object's page shows in its column, its Fiche (an Application's, a Profile's), by the page at `pathname`. */
export function PaneContent({ pathname, page, reader }: { pathname: string; page: ShellPage; reader: DocumentReader }) {
  const [, section, id] = pathname.split("/").map((part) => decodeURIComponent(part));
  if (section === "candidatures" && id && page.pane === "fiche") return <ApplicationFiche applicationId={id} reader={reader} />;
  if (section === "profils" && id && page.pane === "fiche") return <ProfileFiche profileId={id} />;
  return null;
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
