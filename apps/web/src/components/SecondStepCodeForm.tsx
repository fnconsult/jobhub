"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { SECOND_STEP_ENDPOINT } from "@/two-step-verification/gate";

type Failure = { kind: "invalid" } | { kind: "locked"; time: string } | { kind: "error" };

/**
 * A second step (ADR-0075): a code from the authenticator app or a backup code, posted to its endpoint; `onDone` once
 * it is accepted. On the second step's page (`choice`), the Candidate switches between the app's code and a backup
 * code; in Mon compte, before turning the verification off, one field takes either. Without an app (`app` false: on
 * with a passkey, #664), it takes a backup code alone.
 */
export function SecondStepCodeForm({
  choice = false,
  app = true,
  submitLabel,
  locale,
  onDone,
  autoFocus = true,
}: {
  choice?: boolean;
  app?: boolean;
  submitLabel?: string;
  locale: string;
  onDone: () => void;
  /** False when a passkey is offered first. */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [backupChosen, setBackup] = useState(false);
  const backup = backupChosen || !app;
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setFailure(null);
    try {
      const response = await fetch(SECOND_STEP_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (response.ok) return onDone();
      const body = (await response.json().catch(() => ({}))) as { error?: string; retryAt?: string };
      if (body.error === "locked" && body.retryAt) {
        setFailure({ kind: "locked", time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(body.retryAt)) });
      } else setFailure({ kind: body.error === "invalid_code" ? "invalid" : "error" });
    } catch {
      setFailure({ kind: "error" });
    }
    setWorking(false);
  }

  const label = !choice && app ? t("twoStep.security.codeOrBackupLabel") : backup ? t("twoStep.secondStep.backupCodeLabel") : t("twoStep.secondStep.codeLabel");
  return (
    <form className="stack" onSubmit={(event) => void submit(event)}>
      {choice ? <p>{backup ? t("twoStep.secondStep.introBackup") : t("twoStep.secondStep.intro")}</p> : null}
      <Field label={label}>
        <TextInput
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="one-time-code"
          inputMode={choice && !backup ? "numeric" : "text"}
          spellCheck={false}
          required
          autoFocus={autoFocus}
        />
      </Field>
      {failure ? (
        <Note tone="danger" role="alert">
          {failure.kind === "locked" ? t("twoStep.secondStep.locked", { time: failure.time }) : failure.kind === "invalid" ? t("twoStep.secondStep.invalid") : t("twoStep.secondStep.error")}
        </Note>
      ) : null}
      <div className="actions">
        <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working || !code.trim()}>
          {working ? t("twoStep.secondStep.sending") : (submitLabel ?? t("twoStep.secondStep.submit"))}
        </button>
        {choice && app ? (
          <button
            className={buttonClass({ variant: "quiet" })}
            type="button"
            onClick={() => {
              setBackup(!backup);
              setCode("");
              setFailure(null);
            }}
          >
            {backup ? t("twoStep.secondStep.useApp") : t("twoStep.secondStep.useBackupCode")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
