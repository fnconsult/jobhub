import type { ApplicationResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";

/** The Application's Interviews Section. */
export function Interviews({ application }: { application: ApplicationResponse }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space[3] }}>
      {application.interviews.length === 0 ? <AppText>{t("application.interviewsNone")}</AppText> : null}
    </View>
  );
}
