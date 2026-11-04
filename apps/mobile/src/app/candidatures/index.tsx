import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { shareLinkAction } from "../../navigation/links";
import { paths } from "../../navigation/pages";
import { SAMPLE_APPLICATIONS } from "../../sample-data";
import { EmptyScreen } from "../../screens/EmptyScreen";
import { space } from "../../theme/theme";
import { ObjectRow } from "../../ui/ObjectRow";

/** Mes candidatures: the list to come (#691); meanwhile the sample Application, a row with its context menu (#700). */
export default function Applications() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <EmptyScreen>
      <View style={{ alignSelf: "stretch", gap: space[1] }}>
        {SAMPLE_APPLICATIONS.map((application) => {
          const open = () => router.navigate(paths.application(application.id));
          return (
            <ObjectRow
              key={application.id}
              label={application.title}
              onPress={open}
              actions={[{ label: t("mobile.rowMenu.open"), onPress: open }, shareLinkAction(t("mobile.rowMenu.shareLink"), paths.application(application.id))]}
            />
          );
        })}
      </View>
    </EmptyScreen>
  );
}
