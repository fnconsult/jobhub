"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { routes } from "@/routes";

/** What the export holds, one line each (GDPR art. 15 / 20, #171). */
const EXPORT_CONTENTS = ["account", "profiles", "applications", "coaching"] as const;

/**
 * The Candidate's own data (ADR-0010): download all of it, told exactly what
 * the file holds and leaves out, or delete the account, confirmed by typing
 * their email address.
 */
export function AccountDataSection() {
  const { t } = useTranslation();
  const id = useId();
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<"confirmMismatch" | "deleteError" | null>(null);

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setProblem(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.ok) {
        // A full page load: nothing of the deleted account stays in the app's memory.
        window.location.assign(routes.accountDeleted);
        return;
      }
      setProblem(response.status === 400 ? "confirmMismatch" : "deleteError");
    } catch {
      setProblem("deleteError");
    }
    setWorking(false);
  }

  return (
    <Card title={t("accountData.title")} headingId={`${id}-title`}>
      <div className="stack">
        <p>{t("accountData.exportHint")}</p>
        <ul>
          {EXPORT_CONTENTS.map((part) => (
            <li key={part}>{t(`accountData.exportContents.${part}`)}</li>
          ))}
        </ul>
        <p>{t("accountData.exportLeftOut")}</p>
        <div className="actions">
          <a className={buttonClass()} href="/api/account/export" download>
            {t("accountData.export")}
          </a>
        </div>
        <section className="danger-zone stack" aria-labelledby={`${id}-delete-title`}>
          <h3 id={`${id}-delete-title`}>{t("accountData.deleteTitle")}</h3>
          <p id={`${id}-warning`}>{t("accountData.deleteWarning")}</p>
          <form className="stack" onSubmit={deleteAccount} noValidate>
            <Field id={`${id}-confirm`} label={t("accountData.confirmLabel")}>
              <TextInput
                type="email"
                autoComplete="off"
                required
                value={email}
                aria-invalid={problem === "confirmMismatch" ? true : undefined}
                aria-describedby={`${id}-warning`}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <div className="actions">
              <button className={buttonClass({ variant: "danger" })} type="submit" disabled={working}>
                {t("accountData.delete")}
              </button>
            </div>
            {problem ? (
              <Note tone="danger" role="alert">
                {t(`accountData.${problem}`)}
              </Note>
            ) : null}
          </form>
        </section>
      </div>
    </Card>
  );
}
