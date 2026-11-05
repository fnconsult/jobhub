import { APPLICATION_STATUSES, type ApplicationStatus } from "@jobhub/shared";
import type { ApplicationResponse } from "@jobhub/shared/reads";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useOnline } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { RadioList } from "../ui/RadioList";
import { FieldError } from "../ui/TextField";
import { useApplicationWrites } from "./application-writes";
import { Property } from "./Property";

type Outcome = "saved" | "failed" | null;

/**
 * The Application Status on its Fiche, changed by hand as on the web (ApplicationStatusSelect): any Application Status,
 * saved as soon as it is chosen through the web's route (`PATCH /api/applications/:id`), which says whether it took it.
 * « Statut enregistré » once saved; otherwise what went wrong, the status the web app holds still shown. Not while
 * offline (ADR-0076).
 */
export function StatusField({ application }: { application: ApplicationResponse }) {
  const { t } = useTranslation();
  const online = useOnline();
  const writes = useApplicationWrites(application.id);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const name = (status: ApplicationStatus) => t(`applicationStatuses.${status}`);

  async function choose(status: ApplicationStatus) {
    setOpen(false);
    if (status === application.status) return;
    setWorking(true);
    setOutcome(null);
    const saved = await writes.changeStatus(status);
    setWorking(false);
    setOutcome(saved.ok ? "saved" : "failed");
  }

  return (
    <Property label={t("application.statusLabel")}>
      <Control
        label={name(application.status)}
        accessibleName={t("mobile.applications.statusButton", { status: name(application.status) })}
        look="secondary"
        expanded={open}
        disabled={!online || working}
        onPress={() => setOpen(!open)}
      />
      {open && online ? (
        <View style={{ alignSelf: "stretch" }}>
          <RadioList
            label={t("application.statusLabel")}
            options={APPLICATION_STATUSES.map((status) => ({ value: status, label: name(status) }))}
            value={application.status}
            onChange={(status) => void choose(status)}
          />
        </View>
      ) : null}
      {working ? <AppText tone="secondary">{t("application.working")}</AppText> : null}
      {outcome === "saved" ? (
        <View role="status">
          <AppText tone="secondary">{t("application.statusSaved")}</AppText>
        </View>
      ) : null}
      {outcome === "failed" ? <FieldError message={t("application.error")} /> : null}
      {online ? null : <AppText tone="secondary">{t("mobile.offline.writeDisabled")}</AppText>}
    </Property>
  );
}
