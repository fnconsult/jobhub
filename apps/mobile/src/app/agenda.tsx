import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useAgenda } from "../api/reads";
import { AgendaList } from "../agenda/AgendaList";
import { systemSheets } from "../agenda/system-sheets";
import { ReadState } from "../screens/ReadState";
import { space } from "../theme/theme";

/**
 * The signed-in Candidate's Agenda, as `GET /api/agenda` answers it (#684), read through the read cache (kept on the
 * device for when there is no network, #701, forgotten when the session ends), as a list with « Ajouter à mon
 * calendrier » through the device's sheets. Loading, failing and offline as every read shows them (ReadState).
 */
export default function Agenda() {
  const { t } = useTranslation();
  const agenda = useAgenda();
  if (agenda.data) return <AgendaList agenda={agenda.data} sheets={systemSheets} />;
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space[4], padding: space[4] }}>
      <ReadState read={agenda} loading={t("agenda.loading")} failed={t("agenda.loadError")}>
        {() => null}
      </ReadState>
    </View>
  );
}
