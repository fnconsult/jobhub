"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { routes } from "@/routes";

/**
 * The Candidate's own data (ADR-0010): download all of it, or delete the
 * account, confirmed by typing their email address.
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

  const inputId = `${id}-confirm`;
  return (
    <section className="stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("accountData.title")}</h2>
      <p>{t("accountData.exportHint")}</p>
      <a className="button" href="/api/account/export" download>
        {t("accountData.export")}
      </a>
      <h3>{t("accountData.deleteTitle")}</h3>
      <p id={`${id}-warning`}>{t("accountData.deleteWarning")}</p>
      <form className="stack" onSubmit={deleteAccount} noValidate>
        <div className="field">
          <label htmlFor={inputId}>{t("accountData.confirmLabel")}</label>
          <input
            id={inputId}
            className="input"
            type="email"
            autoComplete="off"
            required
            value={email}
            aria-invalid={problem === "confirmMismatch" ? true : undefined}
            aria-describedby={`${id}-warning`}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <button className="button button-danger" type="submit" disabled={working}>
          {t("accountData.delete")}
        </button>
        {problem ? (
          <p className="field-error" role="alert">
            {t(`accountData.${problem}`)}
          </p>
        ) : null}
      </form>
    </section>
  );
}
