import type { ProfileResponse } from "@jobhub/shared/reads";
import { ExternalLink } from "lucide-react-native";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useWorkPane } from "../shell/Shell";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { SessionWebPage } from "../web-pages/WebPageScreen";
import { SearchCriteriaList } from "./SearchCriteriaList";

/**
 * A Profile's Fiche in the app (ADR-0076, #695): read only. Its positioning (its current Master CV's headline), its
 * Search Criteria, its current Master CV and its ATS Score. « Modifier le profil » opens its web page in a WebView, in
 * the Work Pane (full page on a phone, a column on a tablet), signed in with the session as Mon compte's pages are
 * (src/web-pages, #689); that is where the Profile changes.
 */
export function ProfileSummary({ profile }: { profile: ProfileResponse }) {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  const { searchCriteria: criteria, masterCv } = profile;
  const editTitle = t("mobile.profiles.editTitle", { name: profile.name });
  const edit = () => workPane.open({ title: editTitle, fill: true, content: <SessionWebPage path={`/profils/${encodeURIComponent(profile.id)}`} /> });

  return (
    <View style={{ gap: space[6] }}>
      <Part title={t("mobile.profiles.positioning")}>
        <AppText>{masterCv.content.headline || t("profile.notSpecified")}</AppText>
      </Part>
      <Part title={t("cvReview.searchCriteria")}>
        <SearchCriteriaList criteria={criteria} />
      </Part>
      <Part title={t("profile.masterCv")}>
        <AppText>{t("mobile.profiles.masterCvVersion", { version: masterCv.version, name: masterCv.content.fullName })}</AppText>
        {masterCv.content.summary ? <AppText tone="secondary">{masterCv.content.summary}</AppText> : null}
      </Part>
      <Part title={t("atsScore.title")}>
        <AppText>{profile.atsScore === null ? t("profilePage.ats.none") : t("atsScore.score", { score: profile.atsScore })}</AppText>
      </Part>
      <View style={{ gap: space[2] }}>
        <Control label={t("mobile.profiles.edit")} icon={ExternalLink} look="secondary" onPress={edit} />
        <AppText variant="meta" tone="meta">
          {t("mobile.profiles.editOnWeb")}
        </AppText>
      </View>
    </View>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[1] }}>
      <AppText variant="h3">{title}</AppText>
      {children}
    </View>
  );
}
