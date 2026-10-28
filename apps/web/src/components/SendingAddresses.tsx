"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

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

  // Under a step of the setup wizard, whose title is itself an h3.
  const Heading = nested ? "h4" : "h3";
  const [accountAddress, ...added] = sending;
  return (
    <section className="stack" aria-labelledby={`${id}-sending`}>
      <Heading id={`${id}-sending`}>{t("emailIntake.sending.title")}</Heading>
      <p>{t("emailIntake.sending.explanation")}</p>
      <ul>
        {accountAddress ? <li>{t("emailIntake.sending.account", { address: accountAddress })}</li> : null}
        {added.map((address) => (
          <li key={address}>
            {address}{" "}
            <button className="button" type="button" disabled={working} aria-label={t("emailIntake.sending.removeLabel", { address })} onClick={() => void call("DELETE", address)}>
              {t("emailIntake.sending.remove")}
            </button>
          </li>
        ))}
      </ul>
      <form className="stack" onSubmit={(event) => void add(event)}>
        <div className="field">
          <label htmlFor={`${id}-new-sending`}>{t("emailIntake.sending.addLabel")}</label>
          <input id={`${id}-new-sending`} className="input" type="email" inputMode="email" autoComplete="email" value={newSending} onChange={(event) => setNewSending(event.target.value)} required />
        </div>
        <div>
          <button className="button" type="submit" disabled={working}>
            {t("emailIntake.sending.add")}
          </button>
        </div>
      </form>
      {error ? (
        <p className="field-error" role="alert">
          {t(`emailIntake.errors.${error}`)}
        </p>
      ) : null}
    </section>
  );
}
