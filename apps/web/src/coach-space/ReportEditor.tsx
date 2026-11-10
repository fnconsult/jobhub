"use client";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Field, Textarea } from "@/design/Field";
import type { ReportFields } from "./reports";
const FIELDS = ["covered", "nextSteps", "resources"] as const;
export function ReportEditor({ sessionId, initial }: { sessionId: string; initial: ReportFields | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [fields, setFields] = useState(initial ?? { covered: "", nextSteps: "", resources: "" });
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "published" | "failed">("idle");
  async function save(publish: boolean) {
    setStatus("saving");
    const response = await fetch("/api/coach-space/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, fields }),
    }).catch(() => null);
    const saved = response?.ok ? await response.json().catch(() => null) : null;
    if (!saved?.report) {
      setStatus("failed");
      return;
    }
    if (publish) {
      const result = await fetch("/api/coach-space/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "publish", reportId: saved.report.id, revision: saved.report.revision }),
      }).catch(() => null);
      if (!result?.ok) {
        setStatus("failed");
        return;
      }
    }
    setStatus(publish ? "published" : "saved");
    router.refresh();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }
  return (
    <form className="stack" onSubmit={submit}>
      {FIELDS.map((field) => (
        <Field key={field} id={`${id}-${field}`} label={t(`coachReports.${field}`)} hint={field === "resources" ? t("coachReports.resourcesHint") : undefined}>
          <Textarea
            value={fields[field]}
            maxLength={field === "resources" ? 5000 : 10_000}
            onChange={(event) => {
              setFields({ ...fields, [field]: event.target.value });
            }}
          />
        </Field>
      ))}
      <div className="actions">
        <button className="button" type="submit" disabled={status === "saving"}>
          {t("coachReports.save")}
        </button>
        <button className="button" type="button" disabled={status === "saving" || !fields.covered.trim()} onClick={() => void save(true)}>
          {t("coachReports.publish")}
        </button>
      </div>
      {status !== "idle" ? <p role={status === "failed" ? "alert" : "status"}>{t(`coachReports.status.${status}`)}</p> : null}
    </form>
  );
}
