"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { QrCode } from "./QrCode";
import "./TwoStepSetup.css";

const TITLE_ID = "two-step-verification-title";

/**
 * Sets up an authenticator app (ADR-0075): `endpoint` is asked for a new secret as soon as this shows (POST), the QR
 * code and the key to type are shown, then the app's first code turns Two-step verification on (PUT { code }) and the
 * 10 backup codes are shown once. `onDone` once they are kept; `onCancel`, when given, offers « Annuler ». Mon compte
 * (« Sécurité ») uses it with its own endpoint; the second step's page, for an account that must have it (#665), with
 * the setup's.
 */
export function TwoStepSetup({ endpoint, onDone, onCancel }: { endpoint: string; onDone: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once, even when React runs effects twice: each start makes a new secret.
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch(endpoint, { method: "POST" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { secret: string; uri: string };
        setSetup({ secret: body.secret, uri: body.uri });
      } catch {
        setError(t("twoStep.security.error"));
      }
    })();
  }, [endpoint, t]);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (response.status === 400) setError(t("twoStep.security.invalidCode"));
      else if (!response.ok) throw new Error(String(response.status));
      else setCodes(((await response.json()) as { backupCodes: string[] }).backupCodes);
    } catch {
      setError(t("twoStep.security.error"));
    }
    setWorking(false);
  }

  if (codes) return <BackupCodes codes={codes} onDone={onDone} />;

  return (
    <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
      <form className="stack" onSubmit={(event) => void confirm(event)}>
        {setup ? (
          <>
            <p>{t("twoStep.security.scan")}</p>
            <QrCode text={setup.uri} label={t("twoStep.security.qrLabel")} />
            <p>
              {t("twoStep.security.keyLabel")}
              <br />
              <code className="two-step-key" data-two-step-key>
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
            </p>
            <Field label={t("twoStep.security.confirmLabel")}>
              <TextInput name="code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required />
            </Field>
          </>
        ) : null}
        {error ? (
          <Note tone="danger" role="alert">
            {error}
          </Note>
        ) : null}
        <div className="actions">
          {setup ? (
            <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working || !code.trim()}>
              {t("twoStep.security.confirm")}
            </button>
          ) : null}
          {onCancel ? (
            <button className={buttonClass({ variant: "quiet" })} type="button" onClick={onCancel}>
              {t("twoStep.security.cancel")}
            </button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

/** The 10 backup codes, shown once (ADR-0075): to copy or download; `onDone` once the Candidate says they kept them. */
export function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  function download() {
    const file = new Blob([`${t("twoStep.security.fileHeader")}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = t("twoStep.security.fileName");
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Card title={t("twoStep.security.codesTitle")} headingId={TITLE_ID}>
      <div className="stack">
        <Note tone="warn">{t("twoStep.security.codesIntro")}</Note>
        <ul className="two-step-codes" data-backup-codes>
          {codes.map((backupCode) => (
            <li key={backupCode}>
              <code>{backupCode}</code>
            </li>
          ))}
        </ul>
        <div className="actions">
          <button className={buttonClass()} type="button" onClick={() => void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true), () => setCopied(false))}>
            {copied ? t("twoStep.security.copied") : t("twoStep.security.copy")}
          </button>
          <button className={buttonClass()} type="button" onClick={download}>
            {t("twoStep.security.download")}
          </button>
          <button className={buttonClass({ variant: "primary" })} type="button" onClick={onDone}>
            {t("twoStep.security.done")}
          </button>
        </div>
      </div>
    </Card>
  );
}
