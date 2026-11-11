"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/design/Card";
import { Checkbox } from "@/design/Field";
import type { NoticeSettings } from "./index";
export function CoachingNoticeSettings({ initial, audience }: { initial: NoticeSettings; audience: "candidate" | "coach" }) {
  const { t } = useTranslation(),
    [values, setValues] = useState(initial),
    [working, setWorking] = useState(false),
    [status, setStatus] = useState<"saved" | "error" | null>(null);
  async function change(field: keyof NoticeSettings, enabled: boolean) {
    const previous = values;
    setValues({ ...values, [field]: enabled });
    setWorking(true);
    setStatus(null);
    try {
      const response = await fetch("/api/account/coaching-notifications", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: enabled }),
      });
      if (!response.ok) throw Error("not_saved");
      setStatus("saved");
    } catch {
      setValues(previous);
      setStatus("error");
    } finally {
      setWorking(false);
    }
  }
  const fields: (keyof NoticeSettings)[] = audience === "candidate" ? ["hourEmail"] : ["coachEmail", "daily"];
  return (
    <Card title={t("coachingNotices.settings.title")}>
      <div className="stack">
        {fields.map((field) => (
          <Checkbox
            key={field}
            label={t(`coachingNotices.settings.${field}`)}
            checked={values[field]}
            disabled={working}
            onChange={(event) => void change(field, event.target.checked)}
          />
        ))}
        <p>{t("coachingNotices.settings.independent")}</p>
        <p>{t("coachingNotices.settings.contract")}</p>
        {status ? <p role={status === "error" ? "alert" : "status"}>{t(`coachingNotices.settings.${status}`)}</p> : null}
      </div>
    </Card>
  );
}
