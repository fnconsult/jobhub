import type { CoachingResponse } from "@jobhub/shared/reads";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type TextInputProps } from "react-native";
import { useApi, type ApiFetch } from "../api/api";
import { inFrenchTime, wallClockOf } from "../agenda/french-time";
import { useOnline } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { Field, FieldError } from "../ui/TextField";

type Session = CoachingResponse["sessions"][number];

/** The fields the web app checks, each with what to say when it refuses it (as the web's CoachingSessionDialog). */
const ERROR_MESSAGES = {
  scheduledAt: "coachingSession.invalidDate",
  durationMinutes: "coachingSession.invalidDuration",
  videoLink: "coachingSession.invalidVideoLink",
  note: "coachingSession.invalidNote",
} as const;
type SessionField = keyof typeof ERROR_MESSAGES;
type FieldError = { field: string; code: string };

/** How each field's keyboard is set up: never text the Candidate reads. */
const DAY_KEYS = { keyboardType: "numbers-and-punctuation" } as const satisfies TextInputProps;
const NUMBER_KEYS = { keyboardType: "number-pad" } as const satisfies TextInputProps;
const LINK_KEYS = { keyboardType: "url", autoCapitalize: "none", autoCorrect: false } as const satisfies TextInputProps;

/** The form's fields, as typed. */
interface Typed {
  date: string;
  time: string;
  duration: string;
  videoLink: string;
  note: string;
}

/**
 * Saves the Coaching Session's date (`PATCH /api/coaching/sessions/:id`, ADR-0027): only edited optional fields sent, as the
 * web's form sends them. The web app's refusals by field, or `failed` when it could not be reached or failed.
 */
async function saveSession(
  api: ApiFetch,
  id: string,
  typed: Typed,
  initial: Typed,
  withVideoLink: boolean,
): Promise<{ ok: true } | { ok: false; errors: FieldError[] } | { ok: false; failed: true }> {
  const duration = typed.duration.trim();
  const body = {
    scheduledAt: wallClockOf(typed.date, typed.time),
    ...(typed.duration !== initial.duration ? { durationMinutes: duration === "" ? null : Number(duration) } : {}),
    ...(withVideoLink && typed.videoLink !== initial.videoLink ? { videoLink: typed.videoLink.trim() } : {}),
    ...(typed.note !== initial.note ? { note: typed.note } : {}),
  };
  try {
    const response = await api(`/api/coaching/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const answer = (await response.json().catch(() => ({}))) as { errors?: unknown };
    if (response.status === 400 && Array.isArray(answer.errors)) return { ok: false, errors: answer.errors as FieldError[] };
  } catch {
    // Unreachable: said below the form.
  }
  return { ok: false, failed: true };
}

/**
 * Enters or corrects a Coaching Session's date, booked on the Human Coach's Cal.com page (#694, ADR-0027), as the web's
 * form: its date and time in French time, its duration, video link and note, all checked by the web app, which says
 * under each field what it refused. Saved, the page reads Mes coachs humains again (`onSaved`).
 */
export function SessionForm({ session, onSaved, onCancel }: { session: Session; onSaved: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const online = useOnline();
  const at = session.scheduledAt ? inFrenchTime(session.scheduledAt) : { date: "", time: "" };
  const [initial] = useState<Typed>({
    ...at,
    duration: session.durationMinutes === null ? "" : String(session.durationMinutes),
    videoLink: session.videoLink ?? "",
    note: session.note ?? "",
  });
  const [typed, setTyped] = useState<Typed>(initial);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const set = (field: keyof Typed) => (value: string) => setTyped((current) => ({ ...current, [field]: value }));
  const change = { date: set("date"), time: set("time"), duration: set("duration"), videoLink: set("videoLink"), note: set("note") };

  const errorOf = (field: SessionField): string | null => {
    const error = errors.find((candidate) => candidate.field === field);
    if (!error) return null;
    return t(field === "scheduledAt" && error.code === "required" ? "coachingSession.requiredDate" : ERROR_MESSAGES[field]);
  };

  const refused = { scheduledAt: errorOf("scheduledAt"), durationMinutes: errorOf("durationMinutes"), videoLink: errorOf("videoLink"), note: errorOf("note") };

  const save = async () => {
    setWorking(true);
    setFailed(false);
    const saved = await saveSession(api, session.id, typed, initial, session.meeting === undefined);
    setWorking(false);
    if (saved.ok) return onSaved();
    if ("errors" in saved) setErrors(saved.errors);
    else setFailed(true);
  };

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Field label={t("mobile.coaching.session.date")} value={typed.date} onChangeText={change.date} {...DAY_KEYS} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 100 }}>
          <Field label={t("mobile.coaching.session.time")} value={typed.time} onChangeText={change.time} {...DAY_KEYS} />
        </View>
      </View>
      <FieldError message={refused.scheduledAt} />
      <Field label={t("coachingSession.duration")} value={typed.duration} onChangeText={change.duration} {...NUMBER_KEYS} error={refused.durationMinutes} />
      {session.meeting === undefined ? (
        <Field
          label={t("coachingSession.videoLink")}
          hint={t("coachingSession.videoLinkHint")}
          value={typed.videoLink}
          onChangeText={change.videoLink}
          {...LINK_KEYS}
          error={refused.videoLink}
        />
      ) : null}
      <Field label={t("coachingSession.note")} value={typed.note} onChangeText={change.note} multiline maxLength={500} error={refused.note} />
      {failed ? <FieldError message={t("coachingSession.error")} /> : null}
      {online ? null : <AppText tone="secondary">{t("mobile.offline.writeDisabled")}</AppText>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Control
          look="primary"
          label={working ? t("coachingSession.working") : t("coachingSession.save")}
          disabled={working || !online}
          onPress={() => void save()}
        />
        <Control label={t("coachingSession.cancel")} onPress={onCancel} />
      </View>
    </View>
  );
}
