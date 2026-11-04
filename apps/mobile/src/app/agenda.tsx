import { useMemo } from "react";
import { AgendaList } from "../agenda/AgendaList";
import { systemSheets } from "../agenda/system-sheets";
import { sampleAgenda } from "../sample-data";

/** The Agenda as a list, « Ajouter à mon calendrier » through the device's sheets; on sample data until #684's GET /api/agenda. */
export default function Agenda() {
  const agenda = useMemo(() => sampleAgenda(new Date()), []);
  return <AgendaList agenda={agenda} sheets={systemSheets} />;
}
