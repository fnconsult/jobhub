import type { ApplicationResponse } from "@jobhub/shared/reads";
import { useTranslation } from "react-i18next";
import { AppText } from "../ui/AppText";
import { Property } from "./Property";

/** The Application Status, on its Fiche's card. */
export function StatusField({ application }: { application: ApplicationResponse }) {
  const { t } = useTranslation();
  return (
    <Property label={t("application.statusLabel")}>
      <AppText>{t(`applicationStatuses.${application.status}`)}</AppText>
    </Property>
  );
}
