import { createI18n } from "@jobhub/shared/i18n";
import { getLocales } from "expo-localization";

/** The interface in the device's language when the app speaks it, French otherwise (`@jobhub/shared/i18n`). */
export function deviceI18n() {
  return createI18n(getLocales()[0]?.languageCode);
}
