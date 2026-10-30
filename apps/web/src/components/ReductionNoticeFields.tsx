import type { TFunction } from "i18next";
import { Field, Textarea, TextInput } from "@/design/Field";

/**
 * The notice a Back Office Plan form sends when it lowers a paid Plan (#514): the reason the subscribers read and the
 * effective date, `earliest` at the soonest. Optional: a change that lowers nothing, or a Plan nobody pays for, needs none.
 */
export function ReductionNoticeFields({ t, earliest, longEarliest }: { t: TFunction; earliest: string; longEarliest: string }) {
  return (
    <fieldset>
      <legend>{t("admin.quotaReductions.noticeTitle")}</legend>
      <p>{t("admin.quotaReductions.noticeHelp", { date: longEarliest })}</p>
      <Field label={t("admin.quotaReductions.reasonLabel")} hint={t("admin.quotaReductions.reasonHelp")}>
        <Textarea name="reductionReason" maxLength={500} />
      </Field>
      <Field label={t("admin.quotaReductions.effectiveOnLabel")}>
        <TextInput name="reductionEffectiveOn" type="date" min={earliest} />
      </Field>
    </fieldset>
  );
}
