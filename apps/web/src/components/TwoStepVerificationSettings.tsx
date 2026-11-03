"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { PasskeySecondStep } from "./PasskeySecondStep";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { BackupCodes, TwoStepSetup } from "./TwoStepSetup";

const ENDPOINT = "/api/account/two-step-verification";
const TITLE_ID = "two-step-verification-title";

type PasskeyFactor = { kind: "passkey"; id: string; name: string | null; device: string | null; addedAt: Date; lastUsedAt: Date | null };

export interface TwoStepSettingsStatus {
  enabledAt: Date | null;
  factors: ({ kind: "authenticator_app" | "backup_codes"; addedAt: Date; lastUsedAt: Date | null } | PasskeyFactor)[];
  backupCodesLeft: number;
}

/**
 * What the Section shows: the state, an app being set up, a passkey being added or renamed, the backup codes (once),
 * or a second step asked first.
 */
type View =
  | { kind: "status" }
  | { kind: "setup" }
  | { kind: "addPasskey" }
  | { kind: "renamePasskey"; id: string; name: string }
  | { kind: "codes"; codes: string[] }
  | { kind: "secondStep"; then: Change };
type Change = { kind: "disable" } | { kind: "regenerate" } | { kind: "removePasskey"; id: string };

/**
 * Mon compte, « Sécurité » (#663, #664, ADR-0075): Two-step verification. Off, « Activer avec une application » shows a
 * QR code and the key to type, then the app's first code turns it on; « Activer avec une clé d'accès » adds a passkey,
 * named, which turns it on. The 10 backup codes are shown once, to copy or download. On, its factors with their dates,
 * the passkeys renamed or removed one by one, another added; renewing the backup codes, turning it off or removing the
 * last factor asks for a second step first unless one was done less than 10 minutes ago. `mandatory` (an Administrator
 * or a Human Coach, #665): no « Désactiver » and the Section says why.
 */
export function TwoStepVerificationSettings({ status, locale, mandatory }: { status: TwoStepSettingsStatus; locale: string; mandatory: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "status" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const passkeys = status.factors.filter((factor): factor is PasskeyFactor => factor.kind === "passkey");
  const app = status.factors.find((factor) => factor.kind === "authenticator_app");
  const codes = status.factors.find((factor) => factor.kind === "backup_codes");
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

  /** Turned on with the passkeys added: the backup codes. */
  const enableWithPasskey = async () => {
    const reply = await call("PUT", ENDPOINT, { passkey: true });
    if (reply.status !== 200) throw new Error(String(reply.status));
    setView({ kind: "codes", codes: reply.body.backupCodes as string[] });
  };

  const addPasskey = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const added = await authClient.passkey.addPasskey({ name: passkeyName.trim() });
      if (added.error) return setError(t("twoStep.passkeys.addFailed"));
      setPasskeyName("");
      if (!status.enabledAt) return enableWithPasskey();
      setView({ kind: "status" });
      router.refresh();
    });
  };

  const startWithPasskey = () => {
    setError(null);
    // A passkey left by a setup that did not finish turns it on as it is.
    if (passkeys.length > 0) return run(enableWithPasskey);
    setView({ kind: "addPasskey" });
  };

  const renamePasskey = (event: FormEvent, id: string, name: string) => {
    event.preventDefault();
    return run(async () => {
      const renamed = await authClient.passkey.updatePasskey({ id, name: name.trim() });
      if (renamed.error) throw new Error(renamed.error.message);
      setView({ kind: "status" });
      router.refresh();
    });
  };

  const change = (what: Change) =>
    run(async () => {
      const reply =
        what.kind === "disable"
          ? await call("DELETE", ENDPOINT)
          : what.kind === "removePasskey"
            ? await call("DELETE", `${ENDPOINT}/passkeys/${encodeURIComponent(what.id)}`)
            : await call("POST", `${ENDPOINT}/backup-codes`);
      if (reply.status === 403 && reply.body.error === "recent_second_step_required") return setView({ kind: "secondStep", then: what });
      if ((what.kind === "disable" && (reply.status === 204 || reply.status === 409)) || (what.kind === "removePasskey" && (reply.status === 200 || reply.status === 404))) {
        setView({ kind: "status" });
        return router.refresh();
      }
      if (reply.status !== 200) throw new Error(String(reply.status));
      setView({ kind: "codes", codes: reply.body.backupCodes as string[] });
    });

  const failure = error ? (
    <Note tone="danger" role="alert">
      {error}
    </Note>
  ) : null;

  const showStatus = () => setView({ kind: "status" });
  const backToStatus = () => {
    showStatus();
    router.refresh();
  };

  if (view.kind === "setup") return <TwoStepSetup endpoint={ENDPOINT} onDone={backToStatus} onCancel={showStatus} />;

  if (view.kind === "codes") return <BackupCodes codes={view.codes} onDone={backToStatus} />;

  if (view.kind === "addPasskey") {
    return (
      <Card title={t("twoStep.passkeys.addTitle")} headingId={TITLE_ID}>
        <form className="stack" onSubmit={(event) => void addPasskey(event)}>
          <p>{t("twoStep.passkeys.addIntro")}</p>
          <Field label={t("twoStep.passkeys.nameLabel")} hint={t("twoStep.passkeys.nameHint")}>
            <TextInput name="passkey-name" value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} maxLength={60} required autoFocus />
          </Field>
          {failure}
          <div className="actions">
            <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working || !passkeyName.trim()}>
              {working ? t("twoStep.passkeys.waiting") : t("twoStep.passkeys.add")}
            </button>
            <button className={buttonClass({ variant: "quiet" })} type="button" onClick={() => setView({ kind: "status" })}>
              {t("twoStep.security.cancel")}
            </button>
          </div>
        </form>
      </Card>
    );
  }

  if (view.kind === "renamePasskey") {
    return (
      <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
        <form className="stack" onSubmit={(event) => void renamePasskey(event, view.id, view.name)}>
          <Field label={t("twoStep.passkeys.nameLabel")}>
            <TextInput name="passkey-name" value={view.name} onChange={(event) => setView({ ...view, name: event.target.value })} maxLength={60} required autoFocus />
          </Field>
          {failure}
          <div className="actions">
            <button className={buttonClass({ variant: "primary" })} type="submit" disabled={working || !view.name.trim()}>
              {t("twoStep.passkeys.save")}
            </button>
            <button className={buttonClass({ variant: "quiet" })} type="button" onClick={() => setView({ kind: "status" })}>
              {t("twoStep.security.cancel")}
            </button>
          </div>
        </form>
      </Card>
    );
  }

  if (view.kind === "secondStep") {
    return (
      <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
        <div className="stack">
          <p>{passkeys.length > 0 ? t("twoStep.passkeys.confirmIdentity") : t("twoStep.security.confirmIdentity")}</p>
          {passkeys.length > 0 ? <PasskeySecondStep locale={locale} onDone={() => void change(view.then)} /> : null}
          <SecondStepCodeForm locale={locale} app={Boolean(app)} autoFocus={passkeys.length === 0} submitLabel={t("twoStep.security.continue")} onDone={() => void change(view.then)} />
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

  const used = (factor: { lastUsedAt: Date | null }) => (factor.lastUsedAt ? t("twoStep.security.lastUsed", { date: day(factor.lastUsedAt) }) : t("twoStep.security.neverUsed"));
  return (
    <Card title={t("twoStep.security.title")} headingId={TITLE_ID}>
      <div className="stack">
        <p>{t("twoStep.security.explanation")}</p>
        {mandatory ? <p>{t("twoStep.security.mandatory")}</p> : null}
        <p role="status" className="account-status">
          {status.enabledAt ? <Pill tone="success">{t("twoStep.security.onSince", { date: day(status.enabledAt) })}</Pill> : <Pill>{t("twoStep.security.off")}</Pill>}
        </p>
        {status.factors.length > 0 ? (
          <ul data-two-step-factors className="two-step-factors">
            {app ? (
              <li>
                {t("twoStep.security.authenticatorApp")} · {t("twoStep.security.addedOn", { date: day(app.addedAt) })} · {used(app)}
              </li>
            ) : null}
            {passkeys.map((passkey) => (
              <li key={passkey.id} data-passkey>
                <span>
                  <strong>{passkey.name ?? t("twoStep.passkeys.unnamed")}</strong> · {t("twoStep.passkeys.kind")}
                  {passkey.device ? ` (${passkey.device})` : ""} · {t("twoStep.security.addedOn", { date: day(passkey.addedAt) })} · {used(passkey)}
                </span>
                <span className="actions">
                  <button
                    className={buttonClass({ variant: "quiet", size: "sm" })}
                    type="button"
                    disabled={working}
                    aria-label={t("twoStep.passkeys.renameNamed", { name: passkey.name ?? t("twoStep.passkeys.unnamed") })}
                    onClick={() => {
                      setError(null);
                      setView({ kind: "renamePasskey", id: passkey.id, name: passkey.name ?? "" });
                    }}
                  >
                    {t("twoStep.passkeys.rename")}
                  </button>
                  <button
                    className={buttonClass({ variant: "danger", size: "sm" })}
                    type="button"
                    disabled={working}
                    aria-label={t("twoStep.passkeys.removeNamed", { name: passkey.name ?? t("twoStep.passkeys.unnamed") })}
                    onClick={() => void change({ kind: "removePasskey", id: passkey.id })}
                  >
                    {t("twoStep.passkeys.remove")}
                  </button>
                </span>
              </li>
            ))}
            {codes ? (
              <li>
                {t("twoStep.security.backupCodes")} · {t("twoStep.security.codesLeft", { count: status.backupCodesLeft })} ·{" "}
                {t("twoStep.security.codesAddedOn", { date: day(codes.addedAt) })} ·{" "}
                {codes.lastUsedAt ? t("twoStep.security.lastUsed", { date: day(codes.lastUsedAt) }) : t("twoStep.security.codesNeverUsed")}
              </li>
            ) : null}
          </ul>
        ) : null}
        {failure}
        <div className="actions">
          {status.enabledAt ? (
            <>
              <button
                className={buttonClass()}
                type="button"
                disabled={working}
                onClick={() => {
                  setError(null);
                  setView({ kind: "addPasskey" });
                }}
              >
                {t("twoStep.passkeys.addTitle")}
              </button>
              <button className={buttonClass()} type="button" disabled={working} onClick={() => void change({ kind: "regenerate" })}>
                {t("twoStep.security.regenerate")}
              </button>
              {mandatory ? null : (
                <button className={buttonClass({ variant: "danger" })} type="button" disabled={working} onClick={() => void change({ kind: "disable" })}>
                  {t("twoStep.security.disable")}
                </button>
              )}
            </>
          ) : (
            <>
              <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => setView({ kind: "setup" })}>
                {t("twoStep.security.enable")}
              </button>
              <button className={buttonClass()} type="button" disabled={working} onClick={startWithPasskey}>
                {t("twoStep.passkeys.enable")}
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
