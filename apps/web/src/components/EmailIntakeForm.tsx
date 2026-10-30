"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ForwardingAddress } from "@/email-intake";
import type { CandidateSender, PlatformSender } from "@/email-intake/candidate-senders";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { routes } from "@/routes";
import { RecognisedSenders } from "./RecognisedSenders";
import { SendingAddresses } from "./SendingAddresses";

/** What waits for the Candidate's confirmation: both stop the address in use at once. */
type Pending = "replace" | "switchOff" | null;

/**
 * Mon compte's « Réception par email » (#441, ADR-0051): switches Email intake on (dated) or off, shows the
 * Forwarding address to copy, replaces it, and lists the Candidate's own sending addresses for manual forwards and
 * their Recognised senders (#450).
 * The step-by-step setup wizard per mailbox provider (#451) opens from here.
 */
export function EmailIntakeForm({
  forwardingAddress: initial,
  sendingAddresses: initialSending,
  recognisedSenders,
  locale,
}: {
  forwardingAddress: ForwardingAddress | null;
  sendingAddresses: string[];
  recognisedSenders: { own: CandidateSender[]; platform: PlatformSender[] };
  locale: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [forwarding, setForwarding] = useState(initial);
  const [pending, setPending] = useState<Pending>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<"copied" | "copyFailed" | null>(null);
  const [error, setError] = useState(false);

  async function call(url: string, method: string): Promise<Response | null> {
    setWorking(true);
    setError(false);
    setStatus(null);
    try {
      const response = await fetch(url, { method });
      if (!response.ok) throw new Error(String(response.status));
      return response;
    } catch {
      setError(true);
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

  const date = forwarding ? new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(forwarding.activatedAt) : null;
  return (
    <div className="stack">
      <Card title={t("emailIntake.title")} headingId={`${id}-title`}>
        <div className="stack">
        <p>{t("emailIntake.explanation")}</p>
        <p>
          <Link href={routes.accountEmailIntakeWizard}>{t("emailIntake.wizardLink")}</Link>
        </p>
        {forwarding ? (
          <>
            <p role="status">{t("emailIntake.onSince", { date })}</p>
            <Field id={`${id}-address`} label={t("emailIntake.addressLabel")}>
              <TextInput readOnly value={forwarding.address} onFocus={(event) => event.target.select()} />
            </Field>
            <div className="actions">
              <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => void copy()}>
                {t("emailIntake.copy")}
              </button>
              <button className={buttonClass()} type="button" disabled={working} onClick={() => setPending("replace")}>
                {t("emailIntake.replace")}
              </button>
              <button className={buttonClass()} type="button" disabled={working} onClick={() => setPending("switchOff")}>
                {t("emailIntake.switchOff")}
              </button>
            </div>
            {pending ? (
              <div className="stack account-confirm" role="alertdialog" aria-labelledby={`${id}-confirm`}>
                <p id={`${id}-confirm`}>{t(pending === "replace" ? "emailIntake.confirmReplace" : "emailIntake.confirmSwitchOff")}</p>
                <div className="actions">
                  <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => void confirm()}>
                    {t(pending === "replace" ? "emailIntake.replace" : "emailIntake.switchOff")}
                  </button>
                  <button className={buttonClass()} type="button" onClick={() => setPending(null)}>
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
            <div className="actions">
              <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => void switchOn()}>
                {t("emailIntake.switchOn")}
              </button>
            </div>
          </>
        )}
        </div>
      </Card>
      <SendingAddresses initial={initialSending} />
      <RecognisedSenders initial={recognisedSenders} />
      {error ? (
        <Note tone="danger" role="alert">
          {t("emailIntake.errors.error")}
        </Note>
      ) : null}
    </div>
  );
}
