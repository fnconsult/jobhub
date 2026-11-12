"use client";
import { REPORT_REASONS, type ReportReason } from "./values";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/design/Button";
import { Field, Select, TextInput, Textarea, Checkbox } from "@/design/Field";
import { Note } from "@/design/Note";
export function ContentReportForm({ coachId, target, locale }: { coachId: string; target: "page" | "offer"; locale: "fr" | "en" }) {
  const { t } = useTranslation(),
    [reason, setReason] = useState<ReportReason>("misleading"),
    [working, setWorking] = useState(false),
    [result, setResult] = useState<string | null>(null),
    [requestId] = useState(() => crypto.randomUUID());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorking(true);
    setResult(null);
    try {
      const response = await fetch("/api/coaching/content-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId,
          coachId,
          target,
          locale,
          reason,
          explanation: form.get("explanation"),
          name: form.get("name") ?? "",
          email: form.get("email") ?? "",
          goodFaith: form.get("goodFaith") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error();
      setResult(data.id);
    } catch {
      setResult("error");
    } finally {
      setWorking(false);
    }
  }
  if (result && result !== "error")
    return (
      <Note tone="success" role="status" title={t("contentReport.received")}>
        <p>{t("contentReport.reference", { id: result })}</p>
      </Note>
    );
  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <Field label={t("contentReport.reason")}>
        <Select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>
          {REPORT_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`contentReport.reasons.${value}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("contentReport.explanation")}>
        <Textarea name="explanation" required minLength={10} maxLength={4000} />
      </Field>
      <p>{t("contentReport.contactRule")}</p>
      <Field label={t("contentReport.name")}>
        <TextInput name="name" required={reason !== "child_abuse"} maxLength={160} autoComplete="name" />
      </Field>
      <Field label={t("contentReport.emailAddress")}>
        <TextInput name="email" type="email" required={reason !== "child_abuse"} autoComplete="email" />
      </Field>
      <Checkbox name="goodFaith" required label={t("contentReport.goodFaith")} />
      {result === "error" ? (
        <Note tone="danger" role="alert">
          {t("contentReport.invalid")}
        </Note>
      ) : null}
      <Button variant="primary" type="submit" disabled={working}>
        {t("contentReport.send")}
      </Button>
    </form>
  );
}
