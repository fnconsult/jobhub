"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { SecondStepCodeForm } from "./SecondStepCodeForm";
import { BackupCodes, TwoStepSetup } from "./TwoStepSetup";

const ENDPOINT = "/api/account/two-step-verification";
const TITLE_ID = "two-step-verification-title";

export interface TwoStepSettingsStatus {
  enabledAt: Date | null;
  factors: { kind: "authenticator_app" | "backup_codes"; addedAt: Date; lastUsedAt: Date | null }[];
  backupCodesLeft: number;
}

/** What the Section shows: the state, an app being set up, the backup codes (once), or a second step asked first. */
type View = { kind: "status" } | { kind: "setup" } | { kind: "codes"; codes: string[] } | { kind: "secondStep"; then: Change };
type Change = "disable" | "regenerate";

/**
 * Mon compte, « Sécurité » (#663, ADR-0075): Two-step verification. Off, « Activer » shows a QR code and the key to
 * type, then the app's first code turns it on; the 10 backup codes are shown once, to copy or download. On, its
 * factors with their dates; renewing the backup codes or turning it off asks for a second step first unless one was
 * done less than 10 minutes ago. `mandatory` (an Administrator or a Human Coach, #665): no « Désactiver », and the
 * Section says why.
 */
export function TwoStepVerificationSettings({ status, locale, mandatory }: { status: TwoStepSettingsStatus; locale: string; mandatory: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "status" });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const change = (what: Change) =>
    run(async () => {
      const reply = what === "disable" ? await call("DELETE", ENDPOINT) : await call("POST", `${ENDPOINT}/backup-codes`);
      if (reply.status === 403 && reply.body.error === "recent_second_step_required") return setView({ kind: "secondStep", then: what });
      if (what === "disable" && (reply.status === 204 || reply.status === 409)) {
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
        {mandatory ? <p>{t("twoStep.security.mandatory")}</p> : null}
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
              {mandatory ? null : (
                <button className={buttonClass({ variant: "danger" })} type="button" disabled={working} onClick={() => void change("disable")}>
                  {t("twoStep.security.disable")}
                </button>
              )}
            </>
          ) : (
            <button className={buttonClass({ variant: "primary" })} type="button" disabled={working} onClick={() => setView({ kind: "setup" })}>
              {t("twoStep.security.enable")}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
