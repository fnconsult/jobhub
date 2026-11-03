"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { SECOND_STEP_PASSKEY_ENDPOINT } from "@/two-step-verification/gate";

type Failure = { kind: "invalid" | "cancelled" | "error" } | { kind: "locked"; time: string };

async function post(body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const response = await fetch(SECOND_STEP_PASSKEY_ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * « Utiliser une clé d'accès » (#664, ADR-0075): the second step with one of the account's passkeys, on the second
 * step's page and in Mon compte before a change that asks for one. The browser asks for the passkey (Face ID, Touch ID,
 * Windows Hello, a security key); `onDone` once the server accepted it.
 */
export function PasskeySecondStep({ locale, primary = true, onDone }: { locale: string; primary?: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function use() {
    setWorking(true);
    setFailure(null);
    try {
      const challenge = await post({});
      if (!challenge.ok) return setFailure({ kind: "error" });
      let response;
      try {
        response = await startAuthentication({ optionsJSON: challenge.body.options as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      } catch {
        return setFailure({ kind: "cancelled" });
      }
      const answer = await post({ response });
      if (answer.ok) return onDone();
      if (answer.body.error === "locked" && typeof answer.body.retryAt === "string") {
        setFailure({ kind: "locked", time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(new Date(answer.body.retryAt)) });
      } else setFailure({ kind: answer.body.error === "invalid_passkey" ? "invalid" : "error" });
    } catch {
      setFailure({ kind: "error" });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="stack">
      <div className="actions">
        <button className={buttonClass({ variant: primary ? "primary" : "secondary" })} type="button" disabled={working} onClick={() => void use()} data-use-passkey>
          {working ? t("twoStep.passkeys.waiting") : t("twoStep.passkeys.use")}
        </button>
      </div>
      {failure ? (
        <Note tone="danger" role="alert">
          {failure.kind === "locked" ? t("twoStep.secondStep.locked", { time: failure.time }) : t(`twoStep.passkeys.${failure.kind}`)}
        </Note>
      ) : null}
    </div>
  );
}
