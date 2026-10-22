/**
 * The Platform Settings' Back Office writes (#299, ADR-0033), each recorded in the Back Office Audit.
 *
 * `createPlatformSettingsBackOffice(store, backOffice)` mirrors the store's `set` and `restore` with the
 * Administrator making them: each runs through the Back Office's `record`, so the change, its NOTIFY and
 * its entry share one transaction. A save is recorded as `updated`, « Rétablir » as `restored_to_default`,
 * each with the setting's value and source before and after (not secret). A value the setting refuses is
 * recorded as a refused save (`invalid_value`, field `value`), without the value entered. An unchanged
 * value, an empty field (only shown on the page) and a setting not editable record nothing.
 *
 * A value that asks for confirmation (`asksConfirmation`: the DPA marked signed, ADR-0015, #302) is
 * set only once the Administrator confirmed it (`confirmed`); until then it is `unconfirmed`, nothing
 * written or recorded, and the page asks.
 */
import type { PlatformSettingChange, PlatformSettingsStore, RestorePlatformSettingResult, SetPlatformSettingResult } from "../platform-settings";
import { asksConfirmation, platformSetting } from "../platform-settings/catalog";
import type { BackOffice, BackOfficeActor, BackOfficeAttempt } from "./back-office";

/** `unconfirmed`: the value waits for the Administrator's confirmation (a DPA marked signed). */
export type SetPlatformSettingByAdministratorResult = SetPlatformSettingResult | { ok: false; error: "unconfirmed" };

export interface PlatformSettingsBackOffice {
  set(actor: BackOfficeActor, name: string, raw: string, options?: { confirmed?: boolean }): Promise<SetPlatformSettingByAdministratorResult>;
  restore(actor: BackOfficeActor, name: string): Promise<RestorePlatformSettingResult>;
}

const SECTION = "platform_settings";

export function createPlatformSettingsBackOffice(store: Pick<PlatformSettingsStore, "set" | "restore">, backOffice: Pick<BackOffice, "record">): PlatformSettingsBackOffice {
  const changed = (name: string, action: "updated" | "restored_to_default", done: PlatformSettingChange): BackOfficeAttempt | null =>
    done.changed ? { section: SECTION, target: name, action, before: { ...done.before }, after: { ...done.after } } : null;

  return {
    async set(actor, name, raw, { confirmed = false } = {}) {
      const setting = platformSetting(name);
      if (setting && !confirmed && asksConfirmation(setting, raw)) return { ok: false, error: "unconfirmed" };
      return backOffice.record(
        actor,
        (within) => store.set(name, raw, actor.email, within),
        (done) =>
          done.ok
            ? changed(name, "updated", done)
            : done.error === "invalid"
              ? { section: SECTION, target: name, tried: "updated", reason: "invalid_value", field: "value" }
              : null,
      );
    },

    restore(actor, name) {
      return backOffice.record(
        actor,
        (within) => store.restore(name, within),
        (done) => (done.ok ? changed(name, "restored_to_default", done) : null),
      );
    },
  };
}
