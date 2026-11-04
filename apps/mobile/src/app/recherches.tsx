import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { SAMPLE_JOB_OFFERS } from "../sample-data";
import { EmptyScreen } from "../screens/EmptyScreen";
import { useWorkPane } from "../shell/Shell";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { ObjectRow } from "../ui/ObjectRow";

/**
 * Recherches d'offres: to come (#692); meanwhile a sample Job Offer, a row with its context menu (#700), opened in the
 * Work Pane as a Job Search's Result is on the web.
 */
export default function JobSearches() {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  return (
    <EmptyScreen>
      <View style={{ alignSelf: "stretch", gap: space[1] }}>
        {SAMPLE_JOB_OFFERS.map((offer) => {
          const open = () => workPane.open({ title: offer.title, content: <AppText tone="secondary">{t("mobile.jobOfferPlaceholder")}</AppText> });
          return (
            <ObjectRow
              key={offer.id}
              label={offer.title}
              onPress={open}
              actions={[
                { label: t("mobile.rowMenu.open"), onPress: open },
                openPostingAction(t("mobile.rowMenu.openPosting"), offer.postingUrl),
                shareLinkAction(t("mobile.rowMenu.shareLink"), paths.jobOffer(offer.jobSearchId, offer.id)),
              ]}
            />
          );
        })}
      </View>
    </EmptyScreen>
  );
}
