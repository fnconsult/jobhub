"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { CandidateSender, PlatformSender } from "@/email-intake/candidate-senders";

type Senders = { own: CandidateSender[]; platform: PlatformSender[] };
type AddError = "invalid" | "address_needed" | "already_recognised" | "too_many";
const ADD_ERRORS: readonly AddError[] = ["invalid", "address_needed", "already_recognised", "too_many"];

/**
 * The Candidate's own Recognised senders (#450): « C'est une alerte d'offres » by pasting the sending address (« De : »),
 * those they added (removable), and, unless `compact`, the platform's, each of which they can switch off for themselves
 * alone. On Mon compte's « Réception par email »; compact in the forwarding setup wizard.
 */
export function RecognisedSenders({ initial, compact = false, nested = false }: { initial: Senders; compact?: boolean; nested?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [senders, setSenders] = useState(initial);
  const [sender, setSender] = useState("");
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"added" | null>(null);
  const [error, setError] = useState<AddError | "error" | null>(null);

  async function call(method: "POST" | "PATCH" | "DELETE", body: object): Promise<boolean> {
    setWorking(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/account/email-intake/recognised-senders", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 400) {
        const { error: reason } = (await response.json()) as { error: string };
        setError(ADD_ERRORS.includes(reason as AddError) ? (reason as AddError) : "invalid");
        return false;
      }
      if (!response.ok) throw new Error(String(response.status));
      const listed = (await response.json()) as { own: (Omit<CandidateSender, "addedAt"> & { addedAt: string })[]; platform: PlatformSender[] };
      setSenders({ own: listed.own.map((one) => ({ ...one, addedAt: new Date(one.addedAt) })), platform: listed.platform });
      return true;
    } catch {
      setError("error");
      return false;
    } finally {
      setWorking(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (await call("POST", { sender, label: label.trim() || undefined })) {
      setSender("");
      setLabel("");
      setStatus("added");
    }
  }

  // Under a step of the setup wizard, whose title is itself an h3.
  const Heading = nested ? "h4" : "h3";
  const SubHeading = nested ? "h5" : "h4";
  return (
    <section className="stack" aria-labelledby={`${id}-recognised`}>
      <Heading id={`${id}-recognised`}>{t("emailIntake.recognised.title")}</Heading>
      <p>{t("emailIntake.recognised.explanation")}</p>
      <form className="stack" onSubmit={(event) => void add(event)}>
        <div className="field">
          <label htmlFor={`${id}-sender`}>{t("emailIntake.recognised.senderLabel")}</label>
          <input
            id={`${id}-sender`}
            className="input"
            type="text"
            inputMode="email"
            autoComplete="off"
            spellCheck={false}
            value={sender}
            onChange={(event) => setSender(event.target.value)}
            aria-describedby={`${id}-from-hint`}
            required
          />
          <p id={`${id}-from-hint`} className="hint">
            {t("emailIntake.recognised.fromHint")}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-label`}>{t("emailIntake.recognised.labelLabel")}</label>
          <input id={`${id}-label`} className="input" type="text" maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div>
          <button className="button" type="submit" disabled={working}>
            {t("emailIntake.recognised.add")}
          </button>
        </div>
      </form>
      {status ? <p role="status">{t("emailIntake.recognised.added")}</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {t(`emailIntake.recognised.errors.${error}`)}
        </p>
      ) : null}

      <SubHeading>{t("emailIntake.recognised.ownTitle")}</SubHeading>
      {senders.own.length === 0 ? (
        <p>{t("emailIntake.recognised.ownNone")}</p>
      ) : (
        <ul aria-label={t("emailIntake.recognised.ownListLabel")}>
          {senders.own.map((own) => (
            <li key={own.value}>
              {own.label === own.value ? own.value : t("emailIntake.recognised.item", { label: own.label, value: own.value })}{" "}
              <button className="button" type="button" disabled={working} aria-label={t("emailIntake.recognised.removeLabel", { value: own.value })} onClick={() => void call("DELETE", { value: own.value })}>
                {t("emailIntake.recognised.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {compact ? null : (
        <>
          <SubHeading>{t("emailIntake.recognised.platformTitle")}</SubHeading>
          <p>{t("emailIntake.recognised.platformIntro")}</p>
          <ul aria-label={t("emailIntake.recognised.platformListLabel")}>
            {senders.platform.map((listed) => (
              <li key={listed.value} data-switched-off={listed.switchedOff || undefined}>
                {listed.label}
                {listed.switchedOff ? ` (${t("emailIntake.recognised.switchedOff")})` : null}{" "}
                <button
                  className="button"
                  type="button"
                  disabled={working}
                  aria-label={t(listed.switchedOff ? "emailIntake.recognised.switchOnLabel" : "emailIntake.recognised.switchOffLabel", { label: listed.label })}
                  onClick={() => void call("PATCH", { value: listed.value, on: listed.switchedOff })}
                >
                  {t(listed.switchedOff ? "emailIntake.recognised.switchOn" : "emailIntake.recognised.switchOff")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
