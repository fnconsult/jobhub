/**
 * The Platform Settings' Back Office writes (#299, ADR-0033), each recorded in the Back Office Audit.
 *
 * `createPlatformSettingsBackOffice(store, backOffice)` mirrors the store's `set` and `restore` with the
 * Administrator making them: each runs through the Back Office's `record`, so the change, its NOTIFY and
 * its entry share one transaction. A save is recorded as `updated`, « Rétablir » as `restored_to_default`,
 * each with the setting's value and source before and after (not secret). A value the setting refuses is
 * recorded as a refused save (`invalid_value`, field `value`), without the value entered. A change its check
 * refuses (an AI route the AI layer would refuse, a model that fails its test call, #301) is recorded as a
 * refused save or « Rétablir » with the check's Failure Reason and technical detail, the value entered taken
 * out of it. An unchanged value, an empty field (only shown on the page) and a setting not editable record nothing.
 *
 * A value that asks for confirmation (`asksConfirmation`: the DPA marked signed, ADR-0015, #302) is
 * set only once the Administrator confirmed it (`confirmed`), and so is « Rétablir » falling back to
 * it (env's DPA marked signed); until then it is `unconfirmed`, nothing written or recorded, and the
 * page asks.
 */
import type { TechnicalReason } from "@jobhub/shared";
import type { PlatformSettingChange, PlatformSettingsStore, RefusedPlatformSettingChange, RestorePlatformSettingResult, SetPlatformSettingResult } from "../platform-settings";
import { asksConfirmation, platformSetting } from "../platform-settings/catalog";
import type { BackOffice, BackOfficeActor, BackOfficeAttempt } from "./back-office";

/** `unconfirmed`: the value waits for the Administrator's confirmation (a DPA marked signed). */
export type SetPlatformSettingByAdministratorResult = SetPlatformSettingResult | { ok: false; error: "unconfirmed" };
export type RestorePlatformSettingByAdministratorResult = RestorePlatformSettingResult | { ok: false; error: "unconfirmed" };

export interface PlatformSettingsBackOffice {
  set(actor: BackOfficeActor, name: string, raw: string, options?: { confirmed?: boolean }): Promise<SetPlatformSettingByAdministratorResult>;
  restore(actor: BackOfficeActor, name: string, options?: { confirmed?: boolean }): Promise<RestorePlatformSettingByAdministratorResult>;
}

const SECTION = "platform_settings";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `technical` without `entered` where it stands as a word of its own (a model's name, not a part of a host). */
function withoutValue(technical: TechnicalReason, entered: string | null): TechnicalReason {
  const value = entered?.trim();
  if (!value) return technical;
  return { ...technical, message: technical.message.replace(new RegExp(`(?<![\\w.-])${escaped(value)}(?![\\w.-])`, "g"), "…") };
}

export function createPlatformSettingsBackOffice(store: Pick<PlatformSettingsStore, "set" | "restore" | "fallback">, backOffice: Pick<BackOffice, "record">): PlatformSettingsBackOffice {
  const changed = (name: string, action: "updated" | "restored_to_default", done: PlatformSettingChange): BackOfficeAttempt | null =>
    done.changed ? { section: SECTION, target: name, action, before: { ...done.before }, after: { ...done.after } } : null;
  const refused = (name: string, tried: "updated" | "restored_to_default", done: RefusedPlatformSettingChange, entered: string | null): BackOfficeAttempt => ({
    section: SECTION,
    target: name,
    tried,
    reason: done.reason,
    field: "value",
    technical: withoutValue(done.technical, entered),
  });

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
            : done.error === "refused"
              ? refused(name, "updated", done, raw)
              : done.error === "invalid"
                ? { section: SECTION, target: name, tried: "updated", reason: "invalid_value", field: "value" }
                : null,
      );
    },

    async restore(actor, name, { confirmed = false } = {}) {
      const setting = platformSetting(name);
      const fallback = store.fallback(name);
      if (setting && fallback && !confirmed && asksConfirmation(setting, fallback.value)) return { ok: false, error: "unconfirmed" };
      return backOffice.record(
        actor,
        (within) => store.restore(name, within),
        (done) => (done.ok ? changed(name, "restored_to_default", done) : done.error === "refused" ? refused(name, "restored_to_default", done, null) : null),
      );
    },
  };
}
