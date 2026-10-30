"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
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
  const SubHeading = nested ? "h5" : "h4";
  const content = (
    <div className="stack">
      <p>{t("emailIntake.recognised.explanation")}</p>
      <form className="stack" onSubmit={(event) => void add(event)}>
        <Field id={`${id}-sender`} label={t("emailIntake.recognised.senderLabel")} hint={t("emailIntake.recognised.fromHint")}>
          <TextInput inputMode="email" autoComplete="off" spellCheck={false} value={sender} onChange={(event) => setSender(event.target.value)} required />
        </Field>
        <Field id={`${id}-label`} label={t("emailIntake.recognised.labelLabel")}>
          <TextInput maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} />
        </Field>
        <div>
          <button className={buttonClass()} type="submit" disabled={working}>
            {t("emailIntake.recognised.add")}
          </button>
        </div>
      </form>
      {status ? (
        <Note tone="success" role="status">
          {t("emailIntake.recognised.added")}
        </Note>
      ) : null}
      {error ? (
        <Note tone="danger" role="alert">
          {t(`emailIntake.recognised.errors.${error}`)}
        </Note>
      ) : null}

      <SubHeading>{t("emailIntake.recognised.ownTitle")}</SubHeading>
      {senders.own.length === 0 ? (
        <p>{t("emailIntake.recognised.ownNone")}</p>
      ) : (
        <ul className="account-list" aria-label={t("emailIntake.recognised.ownListLabel")}>
          {senders.own.map((own) => (
            <li key={own.value}>
              {own.label === own.value ? own.value : t("emailIntake.recognised.item", { label: own.label, value: own.value })}{" "}
              <button className={buttonClass({ variant: "quiet", size: "sm" })} type="button" disabled={working} aria-label={t("emailIntake.recognised.removeLabel", { value: own.value })} onClick={() => void call("DELETE", { value: own.value })}>
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
          <ul className="account-list" aria-label={t("emailIntake.recognised.platformListLabel")}>
            {senders.platform.map((listed) => (
              <li key={listed.value} data-switched-off={listed.switchedOff || undefined}>
                {listed.label}
                {listed.switchedOff ? ` (${t("emailIntake.recognised.switchedOff")})` : null}{" "}
                <button
                  className={buttonClass({ variant: "quiet", size: "sm" })}
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
    </div>
  );
  // Under a step of the setup wizard, whose title is itself an h3; on Mon compte, a Card of its own.
  if (!nested)
    return (
      <Card title={t("emailIntake.recognised.title")} headingLevel={3} headingId={`${id}-recognised`}>
        {content}
      </Card>
    );
  return (
    <section className="stack" aria-labelledby={`${id}-recognised`}>
      <h4 id={`${id}-recognised`}>{t("emailIntake.recognised.title")}</h4>
      {content}
    </section>
  );
}
