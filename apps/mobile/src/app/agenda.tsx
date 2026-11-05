import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useRead } from "../api/reads";
import { AgendaList } from "../agenda/AgendaList";
import { agendaSchema } from "../agenda/agenda-read";
import { systemSheets } from "../agenda/system-sheets";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";

/**
 * The signed-in Candidate's Agenda, as `GET /api/agenda` answers it (#684), read through the read cache (kept on the
 * device for when there is no network, #701), as a list with « Ajouter à mon calendrier » through the device's sheets.
 */
export default function Agenda() {
  const { t } = useTranslation();
  const agenda = useRead("agenda", "/api/agenda", agendaSchema);
  if (agenda.data) return <AgendaList agenda={agenda.data} sheets={systemSheets} />;
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space[4], padding: space[4] }}>
      {agenda.isError ? (
        <>
          <AppText tone="secondary" centered>
            {t("agenda.loadError")}
          </AppText>
          <Control label={t("errorPage.actions.retry")} onPress={() => void agenda.refetch()} />
        </>
      ) : (
        <AppText tone="secondary" centered>
          {t("agenda.loading")}
        </AppText>
      )}
    </View>
  );
}
