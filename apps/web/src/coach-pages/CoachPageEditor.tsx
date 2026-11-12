"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { CoachPageContent } from "./index";
import { Button } from "@/design/Button";
import { Card } from "@/design/Card";
import { Checkbox, Field, TextInput, Textarea } from "@/design/Field";
import { Note } from "@/design/Note";
import { FileUpload } from "@/design/FileUpload";
import { COACH_PHOTO_MAX_BYTES, COACH_PHOTO_EXTENSIONS } from "./limits";
import { PublicCoachProfile } from "./PublicCoachProfile";
const F = { photo: "photo", presentation: "presentation", specialties: "specialties", languages: "languages" };
const commaList = (value: string) =>
  value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
export function CoachPageEditor({
  coachId,
  name,
  head,
  initial,
  photoUrl,
}: {
  coachId: string;
  name: string;
  head: number;
  initial: CoachPageContent;
  photoUrl: string | null;
}) {
  const { t, i18n } = useTranslation(),
    router = useRouter();
  const [presentation, setPresentation] = useState(initial.presentation),
    [specialties, setSpecialties] = useState(initial.specialties.join(", ")),
    [languages, setLanguages] = useState(initial.languages.join(", "));
  const [photo, setPhoto] = useState<File | null>(null),
    [newPhotoUrl, setNewPhotoUrl] = useState<string | null>(null),
    [removePhoto, setRemovePhoto] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  function choose(file: File | null) {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setNewPhotoUrl(objectUrl.current);
    setPhoto(file);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("coachId", coachId);
    form.set("basedOn", String(head));
    form.set("locale", i18n.language.startsWith("en") ? "en" : "fr");
    form.set("content", JSON.stringify({ presentation, specialties: commaList(specialties), languages: commaList(languages) }));
    form.set("photoAction", photo ? "replace" : removePhoto ? "remove" : "keep");
    if (photo) form.set("photo", photo);
    try {
      const response = await fetch("/api/coach-space/profile", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) setError(result.error ?? "invalid");
      else router.refresh();
    } catch {
      setError("unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card title={t("coachPage.edit")}>
        <form className="stack" onSubmit={submit}>
          <p>{t("coachPage.validationHint")}</p>
          <Field label={t("coachPage.presentation")}>
            <Textarea name={F.presentation} required minLength={20} maxLength={4000} value={presentation} onChange={(e) => setPresentation(e.target.value)} />
          </Field>
          <Field label={t("coachPage.specialties")} hint={t("coachPage.commas")}>
            <TextInput name={F.specialties} value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
          </Field>
          <Field label={t("coachPage.languages")} hint={t("coachPage.commas")}>
            <TextInput name={F.languages} value={languages} onChange={(e) => setLanguages(e.target.value)} />
          </Field>
          <FileUpload
            name={F.photo}
            label={t("coachPage.photo")}
            prompt={t("coachPage.photoPrompt")}
            hint={t("coachPage.photoHint")}
            rules={{ maxBytes: COACH_PHOTO_MAX_BYTES, extensions: COACH_PHOTO_EXTENSIONS }}
            problems={{ too_large: t("coachPage.photoTooLarge"), unsupported_format: t("coachPage.photoInvalid") }}
            onChange={choose}
          />
          {photoUrl ? (
            <Checkbox checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} label={t("coachPage.removePhoto")} />
          ) : null}
          {error ? (
            <Note tone="danger" role="alert">
              {t(error === "conflict" ? "coachPage.conflict" : error === "invalid_photo" ? "coachPage.photoInvalid" : "coachPage.invalid")}
            </Note>
          ) : null}
          {error === "conflict" ? (
            <Button type="button" onClick={() => router.refresh()}>
              {t("coachPage.reload")}
            </Button>
          ) : null}
          <Button variant="primary" type="submit" disabled={busy}>
            {t(busy ? "coachPage.submitting" : "coachPage.submit")}
          </Button>
        </form>
      </Card>
      <Card title={t("coachPage.preview")}>
        <h3>{name}</h3>
        <PublicCoachProfile
          name={name}
          page={{
            presentation,
            specialties: commaList(specialties),
            languages: commaList(languages),
            photoUrl: newPhotoUrl ?? (removePhoto ? null : photoUrl),
          }}
        />
      </Card>
    </>
  );
}
