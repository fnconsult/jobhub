import { isEditable, type PlatformSetting, type PlatformSettingType } from "@/platform-settings/catalog";
import type { EnvOnlyRow, ShownValue } from "@/platform-settings/env-only";
import type { ResolvedPlatformSetting } from "@/platform-settings/resolver";
import { restoreSetting, saveSetting } from "./actions";
import { Here, ScrollFrame, type Ctx } from "./context";
import { SOURCE_TONE } from "./tone";

/** What a boolean setting takes, as env holds it. */
const BOOLEAN_VALUES = ["false", "true"] as const;
/** The values a choice or boolean setting takes, in the order its list shows them. */
const choicesOf = (type: PlatformSettingType): readonly string[] => (type.kind === "choice" ? type.values : type.kind === "boolean" ? BOOLEAN_VALUES : []);

/** An AI routing setting naming a model: picked from its provider's known models, or typed, and tested on save (#301). */
export const isModelSetting = (setting: PlatformSetting) => setting.group === "ai_routing" && setting.name.endsWith("_MODEL");

/** A value only env holds, as Paramètres shows it: never a secret. */
export function ShownEnvValue({ ctx, value }: { ctx: Ctx; value: ShownValue }) {
  switch (value.kind) {
    case "value":
      return <code>{value.value}</code>;
    case "key_versions":
      return <>{ctx.t("admin.platformSettings.envOnly.keyVersions", { versions: value.versions.join(", ") })}</>;
    default:
      return <>{ctx.t(`admin.platformSettings.envOnly.${value.kind}`)}</>;
  }
}

/**
 * Settings, one row each (#298): a Platform Setting with its value in use, its source and the code's default, a value
 * from env that differs from the default flagged, and, for a super-admin, its field and « Rétablir »; a setting only env
 * holds (MAIL_TRANSPORT, the Stripe Prices) with its value, read-only.
 */
export function SettingsTable({ ctx, caption, names, settings, envOnly }: { ctx: Ctx; caption: string; names: readonly string[]; settings: readonly ResolvedPlatformSetting[]; envOnly: readonly EnvOnlyRow[] }) {
  const { t } = ctx;
  const platform = settings.filter((setting) => names.includes(setting.name));
  const fromEnv = envOnly.filter((row) => names.includes(row.name));
  if (platform.length + fromEnv.length === 0) return null;
  const editing = ctx.can.settings && platform.some(isEditable);
  const value = (raw: string) => (raw ? <code>{raw}</code> : t("admin.platformSettings.empty"));
  /** What a setting takes, as its help says it; a model setting: its provider's known models or another, tested on save. */
  const accepted = (setting: PlatformSetting): string =>
    isModelSetting(setting) ? t("admin.platformSettings.rules.model", { provider: ctx.modelProviders[setting.name] ?? "" }) : ctx.rule(setting.type);

  return (
    <ScrollFrame label={caption}>
      <table className="application-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.platformSettings.setting")}</th>
            <th scope="col">{t("admin.platformSettings.value")}</th>
            <th scope="col">{t("admin.platformSettings.source")}</th>
            <th scope="col">{t("admin.platformSettings.default")}</th>
            {editing ? <th scope="col">{t("admin.platformSettings.change")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {platform.map((setting) => (
            <tr key={setting.name} id={`setting-${setting.name}`} data-setting={setting.name}>
              <th scope="row">
                <code>{setting.name}</code>
              </th>
              <td>
                {value(setting.value)}
                {setting.differsFromDefault ? (
                  <>
                    {" "}
                    <strong className="pill" data-tone="danger">
                      {t("admin.platformSettings.differsFlag")}
                    </strong>
                  </>
                ) : null}
                {setting.valid ? null : <p>{t("admin.platformSettings.invalidFlag")}</p>}
              </td>
              <td>
                <span className="pill" data-tone={SOURCE_TONE[setting.source]}>
                  {t(`admin.platformSettings.sources.${setting.source}`)}
                </span>
                {setting.updatedBy && setting.updatedAt ? <p>{t("admin.platformSettings.setBy", { email: setting.updatedBy, at: ctx.at.format(setting.updatedAt) })}</p> : null}
              </td>
              <td>{value(setting.default)}</td>
              {editing ? <td>{isEditable(setting) ? <SettingForm ctx={ctx} setting={setting} accepted={accepted(setting)} /> : null}</td> : null}
            </tr>
          ))}
          {fromEnv.map((row) => (
            <tr key={row.name} id={`setting-${row.name}`} data-setting={row.name}>
              <th scope="row">
                <code>{row.name}</code>
              </th>
              <td>
                <ShownEnvValue ctx={ctx} value={row.shown} />
              </td>
              <td>
                <span className="pill" data-tone={SOURCE_TONE.env}>
                  {t("admin.platformSettings.sources.env")}
                </span>
              </td>
              <td>{t("admin.platformSettings.empty")}</td>
              {editing ? <td>{t("admin.platformSettings.active.readOnlyFromEnv")}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollFrame>
  );
}

/** A super-admin's field for one Platform Setting, and its « Rétablir » once the Back Office set it. */
function SettingForm({ ctx, setting, accepted }: { ctx: Ctx; setting: ResolvedPlatformSetting; accepted: string }) {
  const { t } = ctx;
  const model = isModelSetting(setting);
  return (
    <div className="stack">
      <form className="stack" action={saveSetting}>
        <Here ctx={ctx} />
        <input type="hidden" name="name" value={setting.name} />
        <label className="visually-hidden" htmlFor={`value-${setting.name}`}>
          {t("admin.platformSettings.newValue", { name: setting.name })}
        </label>
        {setting.type.kind === "choice" || setting.type.kind === "boolean" ? (
          // The values the setting takes; "none" first for a provider (#302).
          <select id={`value-${setting.name}`} className="input" name="value" defaultValue={setting.value} aria-describedby={`rule-${setting.name}`}>
            {setting.value && !choicesOf(setting.type).includes(setting.value) ? null : <option value="" disabled hidden />}
            {choicesOf(setting.type).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        ) : (
          /* No min or max: the server checks the bounds, so a refused value is in the Journal. A model is
             picked from its provider's known models or typed (« autre »): it is tested on save. */
          <input
            id={`value-${setting.name}`}
            className="input"
            name="value"
            type="text"
            inputMode={setting.type.kind === "sender" ? "email" : setting.type.kind === "number" ? (setting.type.whole ? "numeric" : "decimal") : setting.type.kind === "url" ? "url" : undefined}
            list={model ? `models-${setting.name}` : undefined}
            defaultValue={setting.value}
            aria-describedby={`rule-${setting.name}`}
          />
        )}
        {model ? (
          <datalist id={`models-${setting.name}`}>
            {(ctx.models.get(ctx.modelProviders[setting.name]!) ?? []).map((choice) => (
              <option key={choice} value={choice} />
            ))}
          </datalist>
        ) : null}
        <p id={`rule-${setting.name}`}>{t("admin.platformSettings.accepted", { rule: accepted })}</p>
        <button className="button button-primary" type="submit">
          {t("admin.platformSettings.save")}
        </button>
      </form>
      {setting.source === "back_office" ? (
        <form className="stack" action={restoreSetting}>
          <Here ctx={ctx} />
          <input type="hidden" name="name" value={setting.name} />
          <p id={`restore-${setting.name}`}>{t("admin.platformSettings.restoreHelp")}</p>
          <button className="button" type="submit" aria-describedby={`restore-${setting.name}`}>
            {t("admin.platformSettings.restore")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
