import { INTERVIEW_FORMATS } from "@jobhub/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View, type TextInputProps } from "react-native";
import { useOnline } from "../offline/read-cache";
import { space } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { Control } from "../ui/Control";
import { RadioList } from "../ui/RadioList";
import { Field, FieldError } from "../ui/TextField";
import type { FieldError as Refusal, WriteOutcome } from "./application-writes";
import { EMPTY_INTERVIEW_DRAFT, type InterviewDraft, type interviewBody } from "./interview-draft";

/** How each field's keyboard is set up: never text the Candidate reads. */
const DAY_KEYS = { keyboardType: "numbers-and-punctuation" } as const satisfies TextInputProps;
const NUMBER_KEYS = { keyboardType: "number-pad" } as const satisfies TextInputProps;

/**
 * The Interview form, as the web's (InterviewFields): its day and time in French time, its duration, format, place or
 * link, and note, each checked by the web app, which says under each field what it refused. Without `interview` it adds
 * one and empties itself once added; with it, it saves that Interview's changes (a new date is a Reschedule), or
 * `onClose`s on « Fermer sans enregistrer », then once saved. `save` is the write it sends (application-writes.ts).
 */
export function InterviewForm({
  interview,
  save,
  onSaved,
  onClose,
}: {
  interview?: InterviewDraft;
  save: (draft: InterviewDraft) => Promise<WriteOutcome>;
  /** Once the web app saved it. */
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [draft, setDraft] = useState<InterviewDraft>(interview ?? EMPTY_INTERVIEW_DRAFT);
  const [errors, setErrors] = useState<Refusal[]>([]);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const set = (field: keyof InterviewDraft) => (value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const refusalOf = (field: keyof ReturnType<typeof interviewBody>): string | null => {
    const error = errors.find((each) => each.field === field);
    if (!error) return null;
    return t(error.code === "required" ? "cvReview.required" : "cvReview.invalidValue");
  };
  const change = { date: set("date"), time: set("time"), durationMinutes: set("durationMinutes"), place: set("place"), note: set("note") };
  const refused = { scheduledAt: refusalOf("scheduledAt"), durationMinutes: refusalOf("durationMinutes"), format: refusalOf("format"), place: refusalOf("place"), note: refusalOf("note") };

  async function submit() {
    setWorking(true);
    setFailed(false);
    const saved = await save(draft);
    setWorking(false);
    if (saved.ok) {
      setErrors([]);
      if (interview) onClose?.();
      else setDraft(EMPTY_INTERVIEW_DRAFT);
      onSaved?.();
    } else if ("errors" in saved) setErrors(saved.errors);
    else setFailed(true);
  }

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <View style={{ flexGrow: 1, flexBasis: 140 }}>
          <Field testID="interview-date" label={t("mobile.applications.interviewDate")} value={draft.date} onChangeText={change.date} {...DAY_KEYS} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: 100 }}>
          <Field testID="interview-time" label={t("mobile.applications.interviewTime")} value={draft.time} onChangeText={change.time} {...DAY_KEYS} />
        </View>
      </View>
      <FieldError message={refused.scheduledAt} />
      <Field
        label={t("application.interviewDuration")}
        hint={t("application.interviewDurationHint")}
        value={draft.durationMinutes}
        onChangeText={change.durationMinutes}
        {...NUMBER_KEYS}
        error={refused.durationMinutes}
      />
      <View style={{ gap: space[1] }}>
        <AppText weight="semiBold">{t("application.interviewFormat")}</AppText>
        <RadioList
          label={t("application.interviewFormat")}
          options={[{ value: "" as const, label: t("application.interviewFormatNone") }, ...INTERVIEW_FORMATS.map((format) => ({ value: format, label: t(`interviewFormats.${format}`) }))]}
          value={draft.format}
          onChange={(format) => setDraft((current) => ({ ...current, format }))}
        />
        <FieldError message={refused.format} />
      </View>
      <Field label={t("application.interviewPlace")} hint={t("application.interviewPlaceHint")} value={draft.place} onChangeText={change.place} maxLength={500} error={refused.place} />
      <Field testID="interview-note" label={t("application.interviewNote")} hint={t("application.interviewNoteHint")} value={draft.note} onChangeText={change.note} maxLength={500} error={refused.note} />
      {failed ? <FieldError message={t("application.error")} /> : null}
      {online ? null : <AppText tone="secondary">{t("mobile.offline.writeDisabled")}</AppText>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Control
          testID="interview-submit"
          look="primary"
          label={working ? t("application.working") : t(interview ? "application.saveInterview" : "application.addInterview")}
          disabled={working || !online}
          onPress={() => void submit()}
        />
        {interview ? <Control label={t("application.cancelInterviewEdit")} disabled={working} onPress={() => onClose?.()} /> : null}
      </View>
    </View>
  );
}
