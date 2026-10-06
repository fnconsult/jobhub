"use client";

import { isSupportedLocale, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { routes } from "@/routes";

/** The Candidate's account settings: Interface Language, and signing out. */
export function AccountSettings({ interfaceLanguage }: { interfaceLanguage: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [saved, setSaved] = useState(false);

  async function changeLanguage(value: string) {
    if (!isSupportedLocale(value)) return;
    setSaved(false);
    const { error } = await authClient.updateUser({ interfaceLanguage: value });
    if (!error) {
      setSaved(true);
      router.refresh();
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.push(routes.home);
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="stack">
        <label htmlFor={id}>{t("account.interfaceLanguage")}</label>
        <select
          id={id}
          className="input"
          defaultValue={interfaceLanguage}
          onChange={(event) => void changeLanguage(event.target.value)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {t(`languages.${locale}`)}
            </option>
          ))}
        </select>
        {saved ? <p role="status">{t("account.saved")}</p> : null}
      </div>
      <button className="button" type="button" onClick={() => void signOut()}>
        {t("account.signOut")}
      </button>
    </div>
  );
}
