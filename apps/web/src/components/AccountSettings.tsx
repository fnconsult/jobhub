"use client";

import { isSupportedLocale, SUPPORTED_LOCALES } from "@jobhub/shared/i18n";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/auth/client";
import { useHydrated } from "@/design/hydrated";

/** The Candidate's Interface Language. (Signing out is in the Sidebar's foot.) */
export function AccountSettings({ interfaceLanguage }: { interfaceLanguage: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  // Picked before the page is hydrated, the language would not be saved (#446).
  const hydrated = useHydrated();
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

  return (
    <div className="stack">
      <div className="stack">
        <label htmlFor={id}>{t("account.interfaceLanguage")}</label>
        <select
          id={id}
          className="input"
          defaultValue={interfaceLanguage}
          disabled={!hydrated}
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
    </div>
  );
}
