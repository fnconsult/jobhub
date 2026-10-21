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

const useSetting = () => useSyncExternalStore(subscribe, readSetting, serverSetting);

/**
 * The text size of the whole interface (ADR-0009) as a select, on the pages
 * read without signing in. Signed in, it is the slider in Préférences.
 */
export function TextSizeControl() {
  const { t } = useTranslation();
  const id = useId();
  const setting = useSetting();

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

/**
 * Mon compte → Préférences: the text size as a native slider of four steps,
 * smallest first, each named under the track and read out as its name.
 */
export function TextSizeSlider() {
  const { t } = useTranslation();
  const id = useId();
  const setting = useSetting();
  const step = TEXT_SIZE_SETTINGS.indexOf(setting);

  return (
    <div className="text-size-slider stack">
      <label htmlFor={id}>{t("textSize.label")}</label>
      <input
        id={id}
        type="range"
        min={0}
        max={TEXT_SIZE_SETTINGS.length - 1}
        step={1}
        value={step}
        aria-valuetext={t(`textSize.${setting}`)}
        aria-describedby={`${id}-hint`}
        onChange={(event) => applySetting(TEXT_SIZE_SETTINGS[Number(event.target.value)] ?? setting)}
      />
      <ol className="text-size-steps" aria-hidden="true">
        {TEXT_SIZE_SETTINGS.map((option) => (
          <li key={option} data-current={option === setting || undefined}>
            {t(`textSize.${option}`)}
          </li>
        ))}
      </ol>
      <p id={`${id}-hint`} className="hint">
        {t("textSize.hint")}
      </p>
    </div>
  );
}
