"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";

/**
 * The Candidate's own sending addresses (#437): their account's, always, and those they add, from which an email they
 * forward by hand is read. On Mon compte's « Réception par email » and in the forwarding setup wizard's manual guide.
 */
export function SendingAddresses({ initial, nested = false }: { initial: string[]; nested?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [sending, setSending] = useState(initial);
  const [newSending, setNewSending] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<"error" | "invalid" | "too_many" | null>(null);

  async function call(method: "POST" | "DELETE", address: string): Promise<boolean> {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/account/email-intake/sending-addresses", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (response.status === 400) {
        const { error: reason } = (await response.json()) as { error: "invalid" | "too_many" };
        setError(reason === "too_many" ? "too_many" : "invalid");
        return false;
      }
      if (!response.ok) throw new Error(String(response.status));
      setSending(((await response.json()) as { sendingAddresses: string[] }).sendingAddresses);
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
    if (await call("POST", newSending)) setNewSending("");
  }

  const [accountAddress, ...added] = sending;
  const content = (
    <div className="stack">
      <p>{t("emailIntake.sending.explanation")}</p>
      <ul className="account-list">
        {accountAddress ? <li>{t("emailIntake.sending.account", { address: accountAddress })}</li> : null}
        {added.map((address) => (
          <li key={address}>
            <span>{address}</span>{" "}
            <button
              className={buttonClass({ variant: "quiet", size: "sm" })}
              type="button"
              disabled={working}
              aria-label={t("emailIntake.sending.removeLabel", { address })}
              onClick={() => void call("DELETE", address)}
            >
              {t("emailIntake.sending.remove")}
            </button>
          </li>
        ))}
      </ul>
      <form className="account-inline-form" onSubmit={(event) => void add(event)}>
        <Field id={`${id}-new-sending`} label={t("emailIntake.sending.addLabel")}>
          <TextInput type="email" inputMode="email" autoComplete="email" value={newSending} onChange={(event) => setNewSending(event.target.value)} required />
        </Field>
        <button className={buttonClass()} type="submit" disabled={working}>
          {t("emailIntake.sending.add")}
        </button>
      </form>
      {error ? (
        <Note tone="danger" role="alert">
          {t(`emailIntake.errors.${error}`)}
        </Note>
      ) : null}
    </div>
  );
  // Under a step of the setup wizard, whose title is itself an h3; on Mon compte, a Card of its own.
  if (!nested)
    return (
      <Card title={t("emailIntake.sending.title")} headingLevel={3} headingId={`${id}-sending`}>
        {content}
      </Card>
    );
  return (
    <section className="stack" aria-labelledby={`${id}-sending`}>
      <h4 id={`${id}-sending`}>{t("emailIntake.sending.title")}</h4>
      {content}
    </section>
  );
}
