import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { openPostingAction, shareLinkAction } from "../navigation/links";
import { paths } from "../navigation/pages";
import { SAMPLE_JOB_OFFERS } from "../sample-data";
import { JobSearchesMenu } from "../menus/MenuPages";
import { useWorkPane } from "../shell/Shell";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { ObjectRow } from "../ui/ObjectRow";

/**
 * Recherches d'offres: its conversation, the Job Searches by Profile a card in it (#690); its Job Offers come with #692,
 * meanwhile a sample one, a row with its context menu (#700), opened in the Work Pane as a Job Search's Result is on the web.
 */
export default function JobSearches() {
  const { t } = useTranslation();
  const workPane = useWorkPane();
  return (
    <JobSearchesMenu>
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
    </JobSearchesMenu>
  );
}
