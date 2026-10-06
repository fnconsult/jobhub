"use client";

import { resolveTextSize, TEXT_SIZE_SETTINGS, TEXT_SIZE_STORAGE_KEY } from "@jobhub/shared/design";
import { useId, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

// The current setting lives on <html data-text-size>, set before first paint by
// the root layout's inline script, so the DOM is the source of truth.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const readSetting = () => resolveTextSize(document.documentElement.dataset.textSize).setting;
const serverSetting = () => resolveTextSize(null).setting;

function applySetting(value: string) {
  const { setting } = resolveTextSize(value);
  document.documentElement.dataset.textSize = setting;
  try {
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, setting);
  } catch {
    // Storage unavailable: the setting still applies for this visit.
  }
  listeners.forEach((listener) => listener());
}

/** Lets the Candidate change the text size of the whole interface (ADR-0009). */
export function TextSizeControl() {
  const { t } = useTranslation();
  const id = useId();
  const setting = useSyncExternalStore(subscribe, readSetting, serverSetting);

  return (
    <div className="text-size-control">
      <label htmlFor={id}>{t("textSize.label")}</label>
      <select id={id} value={setting} onChange={(event) => applySetting(event.target.value)}>
        {TEXT_SIZE_SETTINGS.map((option) => (
          <option key={option} value={option}>
            {t(`textSize.${option}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
