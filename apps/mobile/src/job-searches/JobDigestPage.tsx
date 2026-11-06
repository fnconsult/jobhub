import type { JobDigestResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useJobDigest } from "../api/reads";
import { paths } from "../navigation/pages";
import { ReadState } from "../screens/ReadState";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { FoundJobOffers } from "./FoundJobOffer";

/**
 * A Job Digest sent, in the app (#692), as the web's page of it: its Profile, when it was sent, then its Job Offers, best
 * Match Score first, each opened in the Work Pane with « Suivre » (FoundJobOffers).
 */
export function JobDigestPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const read = useJobDigest(id);
  return (
    <ReadState read={read} notFound={t("mobile.jobDigests.notFound")}>
      {(digest) => <JobDigestView digest={digest} />}
    </ReadState>
  );
}

function JobDigestView({ digest }: { digest: JobDigestResponse }) {
  const { t, i18n } = useTranslation();
  const sentAt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "full", timeZone: "Europe/Paris" }).format(new Date(digest.sentAt));
  const count = digest.jobOffers.length;
  return (
    <View style={{ gap: space[3] }}>
      <AppText variant="h2" heading>
        {t("jobDigest.page.title", { profile: digest.profile.name })}
      </AppText>
      <AppText tone="secondary">{t("jobDigest.sentAt", { date: sentAt })}</AppText>
      {count > 0 ? <AppText>{t("jobDigest.page.intro", { count })}</AppText> : null}
      <FoundJobOffers jobOffers={digest.jobOffers} profile={digest.profile} share={(jobOfferId) => paths.jobDigestOffer(digest.id, jobOfferId)} />
    </View>
  );
}
