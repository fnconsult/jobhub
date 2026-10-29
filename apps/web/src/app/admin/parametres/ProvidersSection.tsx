import type { AiTask } from "@jobhub/ai";
import Link from "next/link";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Note } from "@/design/Note";
import { Pill, Status, type StatusTone } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { ExplainableLabel, type ExplainedContext } from "@/components/ExplainableLabel";
import type { EnvOnlyRow } from "@/platform-settings/env-only";
import { parametresHref, type KeyState, type PossibleProvider } from "@/platform-settings/parametres";
import type { ResolvedPlatformSetting } from "@/platform-settings/resolver";
import { saveSetting } from "./actions";
import { Here, type Ctx } from "./context";
import { tabNameOf } from "./SettingName";
import { SettingsTable } from "./SettingsTable";

/** A missing-key warning, as an Explainable label explains it (#407). */
const KEY_MISSING: ExplainedContext = { kind: "warning", id: "key_missing" };
const ACTIVE_NO_KEY = "active-no-key";

/**
 * « Pourquoi ? » after a missing-key warning (#407): asks the Back Office Assistant why, with the provider and the keys
 * it lacks (by name, never a value).
 */
function WhyMissingKey({ ctx, warning, warningId, rows }: { ctx: Ctx; warning: string; warningId: string; rows: readonly PossibleProvider[] }) {
  const missing = rows.flatMap((row) => row.keys.filter((key) => !key.set).map((key) => key.name));
  return (
    <ExplainableLabel
      subject={warning}
      describedBy={warningId}
      item={{ ...KEY_MISSING, tab: tabNameOf(ctx), source: rows.map((row) => row.tool.name).join(", "), state: missing.join(", ") }}
    >
      {ctx.t("admin.platformSettings.explain.why")}
    </ExplainableLabel>
  );
}

const KEY_TONE: Record<NonNullable<KeyState["source"]>, "success" | "accent" | "danger"> = { database: "success", env: "accent", missing: "danger", unreadable: "danger" };
/** A provider's state as its status dot says it, beside its words (ADR-0009: the dot never stands alone). */
export const STATUS_TONE: Record<PossibleProvider["status"], StatusTone> = {
  configured: "success",
  no_key_needed: "success",
  disabled: "neutral",
  key_missing: "warn",
  setting_missing: "warn",
  awaiting_access: "danger",
  not_configured: "neutral",
};

/** What a possible provider serves, in words: an AI task by its AI Usage name, the identity route, or a feature. */
export function usedByLabel(ctx: Ctx, used: string): string {
  return isFeature(used) ? ctx.t(`admin.platformSettings.providers.usedByValues.${used}`) : ctx.t(`admin.aiUsage.tasks.${used as AiTask}`);
}
const USED_BY_FEATURES = ["identity", "job_discovery", "enriched_contacts", "email", "billing", "sign_in"] as const;
const isFeature = (used: string): used is (typeof USED_BY_FEATURES)[number] => (USED_BY_FEATURES as readonly string[]).includes(used);

/** A key as the providers' table shows it: its name, its source and last 4 characters to who reads the Provider Secrets, else set or missing. */
export function KeyCell({ ctx, keyState }: { ctx: Ctx; keyState: KeyState }) {
  const { t } = ctx;
  return (
    <p>
      <code>{keyState.name}</code>{" "}
      {keyState.source ? (
        <Pill tone={KEY_TONE[keyState.source]}>{t(`admin.providerSecrets.sources.${keyState.source}`)}</Pill>
      ) : (
        <Pill tone={keyState.set ? "success" : "danger"}>{t(keyState.set ? "admin.platformSettings.providers.keySet" : "admin.platformSettings.providers.keyMissing")}</Pill>
      )}
      {keyState.fingerprint ? <> …{keyState.fingerprint}</> : null}
      {keyState.secret ? null : <> ({t("admin.platformSettings.providers.notSecret")})</>}
    </p>
  );
}

/** A key's last connection test: when, and whether it passed; « Jamais testée » before any. */
export function LastTest({ ctx, keyState }: { ctx: Ctx; keyState: KeyState }) {
  const { t } = ctx;
  if (!keyState.secret || keyState.lastTest === undefined) return null;
  if (keyState.lastTest === null) {
    return (
      <p>
        <Status>{t("admin.platformSettings.providers.neverTested")}</Status>
      </p>
    );
  }
  const { at, passed } = keyState.lastTest;
  return (
    <p>
      <code>{keyState.name}</code>{" "}
      <Status tone={passed ? "success" : "danger"}>
        <time dateTime={at.toISOString()}>{t(passed ? "admin.platformSettings.providers.testPassed" : "admin.platformSettings.providers.testFailed", { at: ctx.at.format(at) })}</time>
      </Status>
    </p>
  );
}

/**
 * A provider tab (#396): the « Fournisseur actif » card (the active provider, or those in service, and the tab's
 * settings with their value, source, default and « Rétablir ») then « Fournisseurs possibles »: one row per Tool of the
 * tab's kind with its keys, last connection test, state, own settings, what it serves, its sheet and « Rendre actif ».
 */
export function ProvidersSection({
  ctx,
  rows,
  settings,
  envOnly,
}: {
  ctx: Ctx;
  rows: readonly PossibleProvider[];
  settings: readonly ResolvedPlatformSetting[];
  envOnly: readonly EnvOnlyRow[];
}) {
  const { t, tab } = ctx;
  const tabName = t(`admin.platformSettings.tabs.${tab.id}`);
  const active = tab.activeSetting ? rows.filter((row) => row.active) : rows.filter((row) => row.usedBy.length > 0);
  const missingKey = (row: PossibleProvider) => row.keys.some((key) => !key.set);
  const ownSettings = (row: PossibleProvider) => row.settings.filter((setting) => !tab.settings.includes(setting.name));

  const actions = tab.activeSetting && ctx.can.settings ? tab.activeSetting : undefined;
  const columns: Column<PossibleProvider>[] = [
    {
      key: "provider",
      header: t("admin.platformSettings.providers.provider"),
      rowHeader: true,
      cell: (row) => (
        <>
          <Link
            prefetch={false}
            href={parametresHref(tab.id, { fournisseur: row.tool.id })}
            aria-label={t("admin.platformSettings.providers.open", { name: row.tool.name })}
            data-opens-sheet={row.tool.id}
          >
            {row.tool.name}
          </Link>
          {row.active ? (
            <>
              {" "}
              <Pill tone="success">{t("admin.platformSettings.providers.activeFlag")}</Pill>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: "keys",
      header: t("admin.platformSettings.providers.keys"),
      cell: (row) => (row.keys.length > 0 ? row.keys.map((key) => <KeyCell key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.providers.noKeys")),
    },
    {
      key: "lastTest",
      header: t("admin.platformSettings.providers.lastTest"),
      cell: (row) => (row.keys.some((key) => key.lastTest !== undefined) ? row.keys.map((key) => <LastTest key={key.name} ctx={ctx} keyState={key} />) : t("admin.platformSettings.providers.none")),
    },
    { key: "status", header: t("admin.platformSettings.providers.status"), cell: (row) => <Status tone={STATUS_TONE[row.status]}>{t(`admin.tools.statuses.${row.status}`)}</Status> },
    {
      key: "settings",
      header: t("admin.platformSettings.providers.settings"),
      // Its own settings: those of the tab are in the card above, and every one is on its sheet (#465).
      cell: (row) =>
        ownSettings(row).length > 0
          ? ownSettings(row).map((setting) => (
              <p key={setting.name}>
                <code>{setting.name}</code> = {setting.value ? <code>{setting.value}</code> : t("admin.platformSettings.empty")}
              </p>
            ))
          : t("admin.platformSettings.providers.none"),
    },
    {
      key: "usedBy",
      header: t("admin.platformSettings.providers.usedBy"),
      cell: (row) => (row.usedBy.length > 0 ? row.usedBy.map((used) => usedByLabel(ctx, used)).join(", ") : t("admin.platformSettings.providers.none")),
    },
  ];
  if (actions) {
    columns.push({
      key: "actions",
      header: t("admin.platformSettings.providers.actions"),
      cell: (row) =>
        row.selectable ? (
          <form className="stack" action={saveSetting}>
            <Here ctx={ctx} />
            <input type="hidden" name="name" value={actions} />
            <input type="hidden" name="value" value={row.tool.id} />
            <button className={buttonClass({ size: "sm" })} type="submit" aria-describedby={missingKey(row) ? `no-key-${row.tool.id}` : undefined}>
              {t("admin.platformSettings.providers.makeActive")}
              <span className="visually-hidden"> : {row.tool.name}</span>
            </button>
            {missingKey(row) ? (
              <p>
                <span id={`no-key-${row.tool.id}`}>{t("admin.platformSettings.providers.noKeyWarning")}</span>{" "}
                <WhyMissingKey ctx={ctx} warning={t("admin.platformSettings.providers.noKeyWarning")} warningId={`no-key-${row.tool.id}`} rows={[row]} />
              </p>
            ) : null}
          </form>
        ) : null,
    });
  }

  return (
    <>
      <Card title={t(tab.toolCategories.length > 0 ? "admin.platformSettings.active.title" : "admin.platformSettings.active.settingsTitle")}>
        <div className="stack">
          {tab.toolCategories.length === 0 ? null : tab.activeSetting ? (
            <p className="active-provider" data-active-provider>
              {active.length > 0 ? <Status tone={STATUS_TONE[active[0]!.status]}>{active.map((row) => row.tool.name).join(", ")}</Status> : t("admin.platformSettings.active.none")}
            </p>
          ) : (
            <p data-active-provider>
              {t("admin.platformSettings.active.inUse", { names: active.length > 0 ? active.map((row) => row.tool.name).join(", ") : t("admin.platformSettings.active.none") })}
            </p>
          )}
          {tab.activeSetting && active.some(missingKey) ? (
            <Note tone="warn">
              <p>
                <span id={ACTIVE_NO_KEY}>{t("admin.platformSettings.active.noKey")}</span>{" "}
                <WhyMissingKey ctx={ctx} warning={t("admin.platformSettings.active.noKey")} warningId={ACTIVE_NO_KEY} rows={active.filter(missingKey)} />
              </p>
            </Note>
          ) : null}
          {tab.id === "contact_enrichment" ? <p>{t("admin.platformSettings.enrichedContactsHelp")}</p> : null}
          <SettingsTable ctx={ctx} caption={t("admin.platformSettings.active.settingsCaption", { tab: tabName })} names={tab.settings} settings={settings} envOnly={envOnly} />
        </div>
      </Card>

      {rows.length > 0 ? (
        <section className="stack" aria-labelledby="possible-providers">
          <h2 id="possible-providers">{t("admin.platformSettings.providers.title")}</h2>
          <Table
            label={t("admin.platformSettings.providers.caption", { tab: tabName })}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.tool.id}
            rowAttributes={(row) => ({ "data-provider": row.tool.id })}
          />
        </section>
      ) : null}
    </>
  );
}
