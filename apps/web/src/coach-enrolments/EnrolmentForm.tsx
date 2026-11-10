"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Field, Select, TextInput, Textarea } from "@/design/Field";
import { FileUpload } from "@/design/FileUpload";
import { PROOF_MAX_BYTES } from "./limits";
const COACH = "coach",
  ASSOCIATION = "association",
  KIND = "kind",
  PRESENTATION = "presentation",
  PROOF = "proof";
const RULES = { maxBytes: PROOF_MAX_BYTES, extensions: ["pdf"] };
const FIELDS = [
  { name: "contactName", type: "text", max: 160 },
  { name: "legalName", type: "text", max: 160 },
  { name: "email", type: "email", max: 254 },
  { name: "status", type: "text", max: 120 },
  { name: "siret", type: "text", max: 14 },
  { name: "specialties", type: "text", max: 960 },
  { name: "languages", type: "text", max: 960 },
] as const;
export function EnrolmentForm({ locale, email = "" }: { locale: "fr" | "en"; email?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [proofReady, setProofReady] = useState(false);
  const [working, setWorking] = useState(false),
    [sent, setSent] = useState(false),
    [failed, setFailed] = useState(false),
    [limited, setLimited] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proofReady) {
      setFailed(true);
      return;
    }
    setWorking(true);
    setFailed(false);
    setLimited(false);
    const body = new FormData(event.currentTarget);
    body.set("locale", locale);
    const response = await fetch("/api/coach-enrolments", { method: "POST", body }).catch(() => null);
    setWorking(false);
    if (response?.ok) {
      const answer = await response.json();
      if (answer.confirmed) router.push("/devenir-coach/mes-demandes");
      else setSent(true);
    } else if (response?.status === 429) setLimited(true);
    else setFailed(true);
  }
  if (sent) return <p role="status">{t("coachEnrolment.sent")}</p>;
  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      <Field label={t("coachEnrolment.kind")}>
        <Select name={KIND}>
          <option value={COACH}>{t("coachEnrolment.coach")}</option>
          <option value={ASSOCIATION}>{t("coachEnrolment.association")}</option>
        </Select>
      </Field>
      {FIELDS.map((field) => (
        <Field key={field.name} label={t(`coachEnrolment.fields.${field.name}`)}>
          <TextInput name={field.name} type={field.type} maxLength={field.max} required defaultValue={field.name === "email" ? email : undefined} />
        </Field>
      ))}
      <Field label={t("coachEnrolment.fields.presentation")}>
        <Textarea name={PRESENTATION} minLength={20} maxLength={4000} required />
      </Field>
      <FileUpload
        name={PROOF}
        label={t("coachEnrolment.proof")}
        prompt={t("coachEnrolment.proofPrompt")}
        hint={t("coachEnrolment.proofHint")}
        onChange={(file) => setProofReady(Boolean(file))}
        rules={RULES}
        problems={{ unsupported_format: t("coachEnrolment.proofInvalid"), too_large: t("coachEnrolment.proofLarge") }}
      />
      <button className="button button-primary" type="submit" disabled={working || !proofReady}>
        {t(working ? "coachEnrolment.sending" : "coachEnrolment.submit")}
      </button>
      {failed ? <p role="alert">{t("coachEnrolment.failed")}</p> : null}
      {limited ? <p role="alert">{t("coachEnrolment.tooMany")}</p> : null}
    </form>
  );
}
