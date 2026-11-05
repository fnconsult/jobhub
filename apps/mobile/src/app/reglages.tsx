import { AppSettings } from "../settings/AppSettings";

/** Réglages de l'app: the device's own settings, native (ADR-0076), never the account's. */
export default function AppSettingsPage() {
  return <AppSettings />;
}
