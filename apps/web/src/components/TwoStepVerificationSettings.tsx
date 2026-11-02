"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { QrCode } from "./QrCode";
import { SecondStepCodeForm } from "./SecondStepCodeForm";

const ENDPOINT = "/api/account/two-step-verification";
const TITLE_ID = "two-step-verification-title";

export interface TwoStepSettingsStatus {
  enabledAt: Date | null;
  factors: { kind: "authenticator_app" | "backup_codes"; addedAt: Date; lastUsedAt: Date | null }[];
  backupCodesLeft: number;
}

/** What the Section shows: the state, an app being set up, the backup codes (once), or a second step asked first. */
type View = { kind: "status" } | { kind: "setup"; secret: string; uri: string } | { kind: "codes"; codes: string[] } | { kind: "secondStep"; then: Change };
type Change = "disable" | "regenerate";

/**
 * Mon compte, « Sécurité » (#663, ADR-0075): Two-step verification. Off, « Activer » shows a QR code and the key to
 * type, then the app's first code turns it on; the 10 backup codes are shown once, to copy or download. On, its
 * factors with their dates; renewing the backup codes or turning it off asks for a second step first unless one was
 * done less than 10 minutes ago.
 */
export function TwoStepVerificationSettings({ status, locale }: { status: TwoStepSettingsStatus; locale: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "status" });
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const day = (date: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date(date));

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  }

  async function run(work: () => Promise<void>) {
    setWorking(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(t("twoStep.security.error"));
    }
    setWorking(false);
  }

  const start = () =>
    run(async () => {
      const reply = await call("POST", ENDPOINT);
      if (reply.status !== 200) throw new Error(String(reply.status));
      setCode("");
      setView({ kind: "setup", secret: String(reply.body.secret), uri: String(reply.body.uri) });
    });

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const reply = await call("PUT", ENDPOINT, { code });
      if (reply.status === 400) return setError(t("twoStep.security.invalidCode"));
      if (reply.status !== 200) throw new Error(String(reply.status));
      setView({ kind: "codes", codes: reply.body.backupCodes as string[] });
    });
  };

  const change = (what: Change) =>
    run(async () => {
      const reply = what === "disable" ? await call("DELETE", ENDPOINT) : await call("POST", `${ENDPOINT}/backup-codes`);
      if (reply.status === 403 && reply.body.error === "recent_second_step_required") return setView({ kind: "secondStep", then: what });
      if (what === "disable" && (reply.status === 204 || reply.status === 409)) {
        setView({ kind: "status" });
        return router.refresh();
      }
      if (reply.status !== 200) throw new Error(String(reply.status));
      setCopied(false);
      setView({ kind: "codes", codes: reply.body.backupCodes as string[] });
    });

  function download(codes: string[]) {
    const file = new Blob([`${t("twoStep.security.fileHeader")}\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = t("twoStep.security.fileName");
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const failure = error ? (
    <Note tone="danger" role="alert">
      {error}
    </Note>
  ) : null;

  if (view.kind === "setup") {
    return (
      <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
        <form className="stack" onSubmit={(event) => void confirm(event)}>
          <p>{t("twoStep.security.scan")}</p>
          <QrCode text={view.uri} label={t("twoStep.security.qrLabel")} />
          <p>
            {t("twoStep.security.keyLabel")}
            <br />
            <code className="two-step-key" data-two-step-key>
              {view.secret.replace(/(.{4})/g, "$1 ").trim()}
            </code>
          </p>
          <Field label={t("twoStep.security.confirmLabel")}>
            <TextInput name="code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required />
          </Field>
          {failure}
          <div className="actions">
            <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working || !code.trim()}>
              {t("twoStep.security.confirm")}
            </button>
            <button className={buttonClass({ variant: "quiet" })} type="button" onClick={() => setView({ kind: "status" })}>
              {t("twoStep.security.cancel")}
            </button>
          </div>
        </form>
      </Card>
    );
  }

  if (view.kind === "codes") {
    return (
      <Card title={t("twoStep.security.codesTitle")} headingId={TITLE_ID}>
        <div className="stack">
          <Note tone="warn">{t("twoStep.security.codesIntro")}</Note>
          <ul className="two-step-codes" data-backup-codes>
            {view.codes.map((backupCode) => (
              <li key={backupCode}>
                <code>{backupCode}</code>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className={buttonClass()}
              type="button"
              onClick={() => void navigator.clipboard?.writeText(view.codes.join("\n")).then(() => setCopied(true), () => setCopied(false))}
            >
              {copied ? t("twoStep.security.copied") : t("twoStep.security.copy")}
            </button>
            <button className={buttonClass()} type="button" onClick={() => download(view.codes)}>
              {t("twoStep.security.download")}
            </button>
            <button
              className={buttonClass({ variant: "primary" })}
              type="button"
              onClick={() => {
                setView({ kind: "status" });
                router.refresh();
              }}
            >
              {t("twoStep.security.done")}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (view.kind === "secondStep") {
    return (
      <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
        <div className="stack">
          <p>{t("twoStep.security.confirmIdentity")}</p>
          <SecondStepCodeForm locale={locale} submitLabel={t("twoStep.security.continue")} onDone={() => void change(view.then)} />
          {failure}
          <div className="actions">
            <button className={buttonClass({ variant: "quiet" })} type="button" onClick={() => setView({ kind: "status" })}>
              {t("twoStep.security.cancel")}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  const [app, codes] = status.factors;
  return (
    <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
      <div className="stack">
        <p>{t("twoStep.security.explanation")}</p>
        <p role="status" className="account-status">
          {status.enabledAt ? <Pill tone="success">{t("twoStep.security.onSince", { date: day(status.enabledAt) })}</Pill> : <Pill>{t("twoStep.security.off")}</Pill>}
        </p>
        {app && codes ? (
          <ul data-two-step-factors>
            <li>
              {t("twoStep.security.authenticatorApp")} · {t("twoStep.security.addedOn", { date: day(app.addedAt) })} ·{" "}
              {app.lastUsedAt ? t("twoStep.security.lastUsed", { date: day(app.lastUsedAt) }) : t("twoStep.security.neverUsed")}
            </li>
            <li>
              {t("twoStep.security.backupCodes")} · {t("twoStep.security.codesLeft", { count: status.backupCodesLeft })} ·{" "}
              {t("twoStep.security.codesAddedOn", { date: day(codes.addedAt) })} ·{" "}
              {codes.lastUsedAt ? t("twoStep.security.lastUsed", { date: day(codes.lastUsedAt) }) : t("twoStep.security.codesNeverUsed")}
            </li>
          </ul>
        ) : null}
        {failure}
        <div className="actions">
          {status.enabledAt ? (
            <>
              <button className={buttonClass()} type="button" disabled={working} onClick={() => void change("regenerate")}>
                {t("twoStep.security.regenerate")}
              </button>
              <button className={buttonClass({ variant: "danger" })} type="button" disabled={working} onClick={() => void change("disable")}>
                {t("twoStep.security.disable")}
              </button>
            </>
          ) : (
            <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => void start()}>
              {t("twoStep.security.enable")}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
