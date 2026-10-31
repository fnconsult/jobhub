"use client";

import { PREFERS_DARK, resolveTheme, THEME_SETTINGS, THEME_STORAGE_KEY, type ThemeSetting } from "@jobhub/shared/design";
import { useId, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/design/Field";

// The choice is remembered on this device, like the Text Size. The theme it gives is on <html data-theme>, set before
// first paint by the document's head (themeScript), which keeps following the device under Système.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

const prefersDark = () => window.matchMedia?.(PREFERS_DARK).matches ?? false;
const readSetting = () => resolveTheme(readStored(), false).setting;
const serverSetting = (): ThemeSetting => "system";

function choose(setting: ThemeSetting) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, setting);
  } catch {
    // Storage unavailable: the theme still applies for this visit.
  }
  document.documentElement.dataset.theme = resolveTheme(setting, prefersDark()).theme;
  listeners.forEach((listener) => listener());
}

/**
 * Mon compte › Préférences: the theme the interface is drawn in (#473, ADR-0053), Clair, Sombre or Système (the
 * default, following the device's setting), applied at once.
 */
export function ThemeChoice() {
  const { t } = useTranslation();
  const id = useId();
  const setting = useSyncExternalStore(subscribe, readSetting, serverSetting);

  return (
    <div className="theme-choice stack">
      <span id={`${id}-label`} className="theme-choice-label" aria-hidden="true">
        {t("theme.label")}
      </span>
      <SegmentedControl
        label={t("theme.label")}
        value={setting}
        onValueChange={choose}
        options={THEME_SETTINGS.map((value) => ({ value, label: t(`theme.${value}`) }))}
      />
      <p className="theme-choice-hint">{t("theme.hint")}</p>
    </div>
  );
}
