"use client";

import { createI18n, type Locale } from "@jobhub/shared/i18n";
import { useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const i18n = useMemo(() => createI18n(locale), [locale]);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
