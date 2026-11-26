"use client";

import { useActionState } from "react";
import { useTranslation } from "react-i18next";
import { AGENT_KEY_MAX_DAYS, AGENT_KEY_SCOPES } from "@/agent-keys/values";
import { buttonClass } from "@/design/button-class";
import { Field, Select, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { createAgentKey, type CreateAgentKeyState } from "./agent-keys-actions";

type ErrorCode = "name_required" | "name_invalid" | "name_taken" | "scope_invalid" | "days_invalid";

/** What to say of a field refused: its code under admin.agentKeys.errors. */
function errorOf(state: CreateAgentKeyState, field: "name" | "scope" | "days"): ErrorCode | undefined {
  if (state && "refused" in state) return field === "name" ? "name_taken" : undefined;
  if (!state || !("errors" in state)) return undefined;
  const error = state.errors.find((each) => each.field === field);
  if (!error) return undefined;
  if (field === "name") return error.code === "required" ? "name_required" : "name_invalid";
  return field === "scope" ? "scope_invalid" : "days_invalid";
}

/**
 * « Créer une clé » (#1139): a name, a scope and an expiry of AGENT_KEY_MAX_DAYS at most. The key's value comes back in
 * the action's answer and is shown here, once: never in the address, gone on the next visit.
 */
export function AgentKeyCreateForm({ locale }: { locale: string }) {
  const { t } = useTranslation();
  const [state, action, pending] = useActionState(createAgentKey, null);
  const error = (field: "name" | "scope" | "days") => {
    const code = errorOf(state, field);
    return code ? t(`admin.agentKeys.errors.${code}`, { max: AGENT_KEY_MAX_DAYS }) : undefined;
  };
  const created = state && "created" in state ? state.created : null;
  const errors = { name: error("name"), scope: error("scope"), days: error("days") };
  return (
    <div className="stack">
      {created ? (
        <Note tone="success" role="status" title={t("admin.agentKeys.created.title", { name: created.name })} data-agent-key-created>
          <p>{t("admin.agentKeys.created.once")}</p>
          <Field label={t("admin.agentKeys.created.value")}>
            <TextInput readOnly value={created.value} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} data-agent-key-value />
          </Field>
          <p>{t("admin.agentKeys.created.expires", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(created.expiresAt)) })}</p>
        </Note>
      ) : null}
      <form className="stack parametres-form" action={action} autoComplete="off">
        <Field label={t("admin.agentKeys.create.name")} hint={t("admin.agentKeys.create.nameHint")} error={errors.name}>
          <TextInput name="name" required pattern="[a-z][a-z0-9\-]{1,39}" maxLength={40} placeholder={t("admin.agentKeys.create.namePlaceholder")} />
        </Field>
        <Field label={t("admin.agentKeys.create.scope")} error={errors.scope}>
          <Select name="scope" defaultValue={AGENT_KEY_SCOPES[0]}>
            {AGENT_KEY_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {t(`admin.agentKeys.scopes.${scope}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("admin.agentKeys.create.days")} hint={t("admin.agentKeys.create.daysHint", { max: AGENT_KEY_MAX_DAYS })} error={errors.days}>
          <TextInput name="days" type="number" inputMode="numeric" min={1} max={AGENT_KEY_MAX_DAYS} step={1} defaultValue={AGENT_KEY_MAX_DAYS} required />
        </Field>
        <div>
          <button className={buttonClass({ variant: "primary" })} type="submit" disabled={pending}>
            {pending ? t("admin.agentKeys.create.creating") : t("admin.agentKeys.create.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
