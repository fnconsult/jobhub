import { isEditable, type PlatformSetting, type PlatformSettingType } from "@/platform-settings/catalog";
import type { EnvOnlyRow, ShownValue } from "@/platform-settings/env-only";
import type { ResolvedPlatformSetting } from "@/platform-settings/resolver";
import { restoreSetting, saveSetting } from "./actions";
import { buttonClass } from "@/design/button-class";
import { Select, TextInput } from "@/design/Field";
import { Pill } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { Here, type Ctx } from "./context";
import { SettingName } from "./SettingName";
import { SOURCE_TONE } from "./tone";

/** What a boolean setting takes, as env holds it. */
const BOOLEAN_VALUES = ["false", "true"] as const;
/** The values a choice or boolean setting takes, in the order its list shows them. */
const choicesOf = (type: PlatformSettingType): readonly string[] => (type.kind === "choice" ? type.values : type.kind === "boolean" ? BOOLEAN_VALUES : []);

/** An AI routing setting naming a model: picked from its provider's known models, or typed, and tested on save (#301). */
export const isModelSetting = (setting: PlatformSetting) => setting.group === "ai_routing" && setting.name.endsWith("_MODEL");

/** A value only env holds, in words: never a secret. */
export function shownEnvText(ctx: Ctx, value: ShownValue): string {
  switch (value.kind) {
    case "value":
      return value.value;
    case "key_versions":
      return ctx.t("admin.platformSettings.envOnly.keyVersions", { versions: value.versions.join(", ") });
    default:
      return ctx.t(`admin.platformSettings.envOnly.${value.kind}`);
  }
}

/** A value only env holds, as Paramètres shows it: never a secret. */
export function ShownEnvValue({ ctx, value }: { ctx: Ctx; value: ShownValue }) {
  return value.kind === "value" ? <code>{value.value}</code> : <>{shownEnvText(ctx, value)}</>;
}

/** What a Platform Setting's row says of its state, for the Back Office Assistant (#407): its default, and its flags. */
function settingState(ctx: Ctx, setting: ResolvedPlatformSetting): string {
  const { t } = ctx;
  return [
    `${t("admin.platformSettings.default")} : ${setting.default || t("admin.platformSettings.empty")}`,
    setting.differsFromDefault ? t("admin.platformSettings.differsFlag") : null,
    setting.valid ? null : t("admin.platformSettings.invalidFlag"),
  ]
    .filter(Boolean)
    .join(" ; ");
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

  type Row = { kind: "platform"; setting: ResolvedPlatformSetting } | { kind: "env"; row: EnvOnlyRow };
  const rows: Row[] = [...platform.map((setting) => ({ kind: "platform" as const, setting })), ...fromEnv.map((row) => ({ kind: "env" as const, row }))];
  const nameOf = (row: Row) => (row.kind === "platform" ? row.setting.name : row.row.name);
  const columns: Column<Row>[] = [
    {
      key: "setting",
      header: t("admin.platformSettings.setting"),
      rowHeader: true,
      cell: (row) =>
        row.kind === "platform" ? (
          <SettingName
            ctx={ctx}
            name={row.setting.name}
            item={{ value: row.setting.value, source: t(`admin.platformSettings.sources.${row.setting.source}`), state: settingState(ctx, row.setting) }}
          />
        ) : (
          <SettingName
            ctx={ctx}
            name={row.row.name}
            item={{ value: shownEnvText(ctx, row.row.shown), source: t("admin.platformSettings.sources.env"), state: t("admin.platformSettings.active.readOnlyFromEnv") }}
          />
        ),
    },
    {
      key: "value",
      header: t("admin.platformSettings.value"),
      cell: (row) =>
        row.kind === "platform" ? (
          <>
            {value(row.setting.value)}
            {row.setting.differsFromDefault ? (
              <>
                {" "}
                <strong>
                  <Pill tone="danger">{t("admin.platformSettings.differsFlag")}</Pill>
                </strong>
              </>
            ) : null}
            {row.setting.valid ? null : <p>{t("admin.platformSettings.invalidFlag")}</p>}
          </>
        ) : (
          <ShownEnvValue ctx={ctx} value={row.row.shown} />
        ),
    },
    {
      key: "source",
      header: t("admin.platformSettings.source"),
      cell: (row) =>
        row.kind === "platform" ? (
          <>
            <Pill tone={SOURCE_TONE[row.setting.source]}>{t(`admin.platformSettings.sources.${row.setting.source}`)}</Pill>
            {row.setting.updatedBy && row.setting.updatedAt ? <p>{t("admin.platformSettings.setBy", { email: row.setting.updatedBy, at: ctx.at.format(row.setting.updatedAt) })}</p> : null}
          </>
        ) : (
          <Pill tone={SOURCE_TONE.env}>{t("admin.platformSettings.sources.env")}</Pill>
        ),
    },
    { key: "default", header: t("admin.platformSettings.default"), cell: (row) => (row.kind === "platform" ? value(row.setting.default) : t("admin.platformSettings.empty")) },
  ];
  if (editing) {
    columns.push({
      key: "change",
      header: t("admin.platformSettings.change"),
      cell: (row) =>
        row.kind === "env" ? t("admin.platformSettings.active.readOnlyFromEnv") : isEditable(row.setting) ? <SettingForm ctx={ctx} setting={row.setting} accepted={accepted(row.setting)} /> : null,
    });
  }

  return (
    <div className="settings-table">
      <Table label={caption} columns={columns} rows={rows} rowKey={nameOf} rowAttributes={(row) => ({ id: `setting-${nameOf(row)}`, "data-setting": nameOf(row) })} />
    </div>
  );
}

/** A super-admin's field for one Platform Setting, and its « Rétablir » once the Back Office set it. */
function SettingForm({ ctx, setting, accepted }: { ctx: Ctx; setting: ResolvedPlatformSetting; accepted: string }) {
  const { t } = ctx;
  const model = isModelSetting(setting);
  return (
    <div className="setting-change">
      <form className="setting-form" action={saveSetting}>
        <Here ctx={ctx} />
        <input type="hidden" name="name" value={setting.name} />
        <label className="visually-hidden" htmlFor={`value-${setting.name}`}>
          {t("admin.platformSettings.newValue", { name: setting.name })}
        </label>
        {setting.type.kind === "choice" || setting.type.kind === "boolean" ? (
          // The values the setting takes; "none" first for a provider (#302).
          <Select id={`value-${setting.name}`} name="value" defaultValue={setting.value} aria-describedby={`rule-${setting.name}`}>
            {setting.value && !choicesOf(setting.type).includes(setting.value) ? null : <option value="" disabled hidden />}
            {choicesOf(setting.type).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </Select>
        ) : (
          /* No min or max: the server checks the bounds, so a refused value is in the Journal. A model is
             picked from its provider's known models or typed (« autre »): it is tested on save. */
          <TextInput
            id={`value-${setting.name}`}
            name="value"
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
        <p id={`rule-${setting.name}`} className="setting-hint">
          {t("admin.platformSettings.accepted", { rule: accepted })}
        </p>
        {/* One per row: a secondary button, so the page's one primary action stays « + Ajouter ». */}
        <button className={buttonClass({ size: "sm" })} type="submit">
          {t("admin.platformSettings.save")}
        </button>
      </form>
      {setting.source === "back_office" ? (
        <form className="setting-form" action={restoreSetting}>
          <Here ctx={ctx} />
          <input type="hidden" name="name" value={setting.name} />
          <p id={`restore-${setting.name}`} className="setting-hint">
            {t("admin.platformSettings.restoreHelp")}
          </p>
          <button className={buttonClass({ size: "sm" })} type="submit" aria-describedby={`restore-${setting.name}`}>
            {t("admin.platformSettings.restore")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
