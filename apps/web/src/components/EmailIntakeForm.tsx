"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

interface ForwardingAddress {
  address: string;
  activatedAt: Date;
}

/** What waits for the Candidate's confirmation: both stop the address in use at once. */
type Pending = "replace" | "switchOff" | null;

/**
 * Mon compte's « Réception par email » (#441, ADR-0051): switches Email intake on (dated) or off, shows the
 * Forwarding address to copy, replaces it, and lists the Candidate's own sending addresses for manual forwards.
 * The step-by-step setup wizard per mailbox provider comes later.
 */
export function EmailIntakeForm({
  forwardingAddress: initial,
  sendingAddresses: initialSending,
  locale,
}: {
  forwardingAddress: ForwardingAddress | null;
  sendingAddresses: string[];
  locale: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [forwarding, setForwarding] = useState(initial);
  const [sending, setSending] = useState(initialSending);
  const [newSending, setNewSending] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"copied" | "copyFailed" | null>(null);
  const [error, setError] = useState<"error" | "invalid" | "too_many" | null>(null);

  async function call(url: string, method: string, body?: unknown): Promise<Response | null> {
    setWorking(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      if (response.status === 400) {
        const { error: reason } = (await response.json()) as { error: "invalid" | "too_many" };
        setError(reason === "too_many" ? "too_many" : "invalid");
        return null;
      }
      if (!response.ok) throw new Error(String(response.status));
      return response;
    } catch {
      setError("error");
      return null;
    } finally {
      setWorking(false);
    }
  }

  const read = async (response: Response): Promise<ForwardingAddress> => {
    const given = (await response.json()) as { address: string; activatedAt: string };
    return { address: given.address, activatedAt: new Date(given.activatedAt) };
  };

  async function switchOn() {
    const response = await call("/api/account/email-intake", "PUT");
    if (response) setForwarding(await read(response));
  }

  async function confirm() {
    const action = pending;
    setPending(null);
    if (action === "replace") {
      const response = await call("/api/account/email-intake/replace", "POST");
      if (response) setForwarding(await read(response));
    } else if (action === "switchOff") {
      if (await call("/api/account/email-intake", "DELETE")) setForwarding(null);
    }
  }

  async function copy() {
    if (!forwarding) return;
    try {
      await navigator.clipboard.writeText(forwarding.address);
      setStatus("copied");
    } catch {
      setStatus("copyFailed");
    }
  }

  async function addSending(event: FormEvent) {
    event.preventDefault();
    const response = await call("/api/account/email-intake/sending-addresses", "POST", { address: newSending });
    if (!response) return;
    setSending(((await response.json()) as { sendingAddresses: string[] }).sendingAddresses);
    setNewSending("");
  }

  async function removeSending(address: string) {
    const response = await call("/api/account/email-intake/sending-addresses", "DELETE", { address });
    if (response) setSending(((await response.json()) as { sendingAddresses: string[] }).sendingAddresses);
  }

  const date = forwarding ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(forwarding.activatedAt) : null;
  const [accountAddress, ...added] = sending;
  return (
    <div className="stack">
      <section className="stack" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{t("emailIntake.title")}</h2>
        <p>{t("emailIntake.explanation")}</p>
        {forwarding ? (
          <>
            <p role="status">{t("emailIntake.onSince", { date })}</p>
            <div className="field">
              <label htmlFor={`${id}-address`}>{t("emailIntake.addressLabel")}</label>
              <input id={`${id}-address`} className="input" type="text" readOnly value={forwarding.address} onFocus={(event) => event.target.select()} />
            </div>
            <div className="actions">
              <button className="button button-primary" type="button" disabled={working} onClick={() => void copy()}>
                {t("emailIntake.copy")}
              </button>
              <button className="button" type="button" disabled={working} onClick={() => setPending("replace")}>
                {t("emailIntake.replace")}
              </button>
              <button className="button" type="button" disabled={working} onClick={() => setPending("switchOff")}>
                {t("emailIntake.switchOff")}
              </button>
            </div>
            {pending ? (
              <div className="stack" role="alertdialog" aria-labelledby={`${id}-confirm`}>
                <p id={`${id}-confirm`}>{t(pending === "replace" ? "emailIntake.confirmReplace" : "emailIntake.confirmSwitchOff")}</p>
                <div className="actions">
                  <button className="button button-primary" type="button" disabled={working} onClick={() => void confirm()}>
                    {t(pending === "replace" ? "emailIntake.replace" : "emailIntake.switchOff")}
                  </button>
                  <button className="button" type="button" onClick={() => setPending(null)}>
                    {t("emailIntake.cancel")}
                  </button>
                </div>
              </div>
            ) : null}
            {status ? <p role="status">{t(`emailIntake.${status}`)}</p> : null}
          </>
        ) : (
          <>
            <p role="status">{t("emailIntake.off")}</p>
            <button className="button button-primary" type="button" disabled={working} onClick={() => void switchOn()}>
              {t("emailIntake.switchOn")}
            </button>
          </>
        )}
      </section>
      <section className="stack" aria-labelledby={`${id}-sending`}>
        <h3 id={`${id}-sending`}>{t("emailIntake.sending.title")}</h3>
        <p>{t("emailIntake.sending.explanation")}</p>
        <ul>
          {accountAddress ? <li>{t("emailIntake.sending.account", { address: accountAddress })}</li> : null}
          {added.map((address) => (
            <li key={address}>
              {address}{" "}
              <button className="button" type="button" disabled={working} aria-label={t("emailIntake.sending.removeLabel", { address })} onClick={() => void removeSending(address)}>
                {t("emailIntake.sending.remove")}
              </button>
            </li>
          ))}
        </ul>
        <form className="stack" onSubmit={(event) => void addSending(event)}>
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
      </section>
      {error ? (
        <p className="field-error" role="alert">
          {t(`emailIntake.errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}
