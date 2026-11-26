import Link from "next/link";
import type { AgentKey, AgentKeyCall } from "@/agent-keys";
import { AGENT_KEY_LOG_SIZE } from "@/agent-keys/values";
import { Card } from "@/design/Card";
import { buttonClass } from "@/design/button-class";
import { Note } from "@/design/Note";
import { Status } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { parametresHref } from "@/platform-settings/parametres";
import { AgentKeyCreateForm } from "./AgentKeyCreateForm";
import { revokeAgentKey } from "./agent-keys-actions";
import { AGENT_KEY_PARAMS } from "./agent-keys-params";
import type { Ctx } from "./context";

/** The anchor of a key's journal. */
const JOURNAL_ID = "agent-key-journal";

/** A key's state now: revoked (when), expired, or active. */
function stateOf(key: AgentKey, now: Date): "active" | "revoked" | "expired" {
  if (key.revokedAt) return "revoked";
  return key.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * Paramètres › « Clés d'agent » (#1139, ADR-0118), super-admins only: « Créer une clé », then every key with its scope,
 * expiry, last use and state, « Révoquer » and its « Journal » (its latest AGENT_KEY_LOG_SIZE calls). Never a value but
 * once, in the creation form's answer.
 */
export function AgentKeysSection({ ctx, keys, journal, revoked, now }: { ctx: Ctx; keys: readonly AgentKey[]; journal: { key: AgentKey; calls: readonly AgentKeyCall[] } | null; revoked: string | null; now: Date }) {
  const { t } = ctx;
  const date = (value: Date) => ctx.at.format(value);
  const journalHref = (key: AgentKey) => parametresHref("agent_keys", { [AGENT_KEY_PARAMS.journal]: key.id }, JOURNAL_ID);
  const closeJournalHref = parametresHref("agent_keys");
  const keyColumns: Column<AgentKey>[] = [
    { key: "name", header: t("admin.agentKeys.columns.name"), rowHeader: true, cell: (key) => <code>{key.name}</code> },
    { key: "scope", header: t("admin.agentKeys.columns.scope"), cell: (key) => t(`admin.agentKeys.scopes.${key.scope}`) },
    { key: "createdAt", header: t("admin.agentKeys.columns.createdAt"), cell: (key) => date(key.createdAt) },
    { key: "expiresAt", header: t("admin.agentKeys.columns.expiresAt"), cell: (key) => date(key.expiresAt) },
    { key: "lastUsedAt", header: t("admin.agentKeys.columns.lastUsedAt"), cell: (key) => (key.lastUsedAt ? date(key.lastUsedAt) : t("admin.agentKeys.never")) },
    {
      key: "state",
      header: t("admin.agentKeys.columns.state"),
      cell: (key) => {
        const state = stateOf(key, now);
        return <Status tone={state === "active" ? "success" : "neutral"}>{t(`admin.agentKeys.states.${state}`, { date: key.revokedAt ? date(key.revokedAt) : "" })}</Status>;
      },
    },
    {
      key: "actions",
      header: t("admin.agentKeys.columns.actions"),
      cell: (key) => (
        <div className="row-actions">
          <Link prefetch={false} className={buttonClass({ size: "sm" })} href={journalHref(key)} aria-label={t("admin.agentKeys.journal.openLabel", { name: key.name })}>
            {t("admin.agentKeys.journal.open")}
          </Link>
          {key.revokedAt ? null : (
            <form action={revokeAgentKey}>
              <input type="hidden" name={AGENT_KEY_PARAMS.key} value={key.id} />
              <button className={buttonClass({ variant: "danger", size: "sm" })} type="submit" aria-label={t("admin.agentKeys.revokeLabel", { name: key.name })}>
                {t("admin.agentKeys.revoke")}
              </button>
            </form>
          )}
        </div>
      ),
    },
  ];
  const callColumns: Column<AgentKeyCall>[] = [
    { key: "at", header: t("admin.agentKeys.journal.at"), cell: (call) => date(call.at) },
    { key: "call", header: t("admin.agentKeys.journal.call"), rowHeader: true, cell: (call) => <code>{`${call.method} ${call.path}`}</code> },
    { key: "outcome", header: t("admin.agentKeys.journal.outcome"), cell: (call) => <Status tone={call.outcome === "allowed" ? "success" : "danger"}>{t(`admin.agentKeys.outcomes.${call.outcome}`)}</Status> },
  ];
  return (
    <>
      {revoked ? (
        <Note tone="success" role="status">
          <p>{t("admin.agentKeys.revoked", { name: revoked })}</p>
        </Note>
      ) : null}
      <p>{t("admin.agentKeys.intro")}</p>
      <Card title={t("admin.agentKeys.create.title")}>
        <AgentKeyCreateForm locale={ctx.locale} />
      </Card>
      <Card title={t("admin.agentKeys.title")}>
        {keys.length === 0 ? (
          <p>{t("admin.agentKeys.none")}</p>
        ) : (
          <Table
            label={t("admin.agentKeys.caption")}
            data-agent-keys
            rows={keys}
            rowKey={(key) => key.id}
            rowAttributes={(key) => ({ "data-agent-key": key.name })}
            columns={keyColumns}
          />
        )}
      </Card>
      {journal ? (
        <section id={JOURNAL_ID} aria-labelledby={`${JOURNAL_ID}-title`} data-agent-key-journal>
          <Card title={<span id={`${JOURNAL_ID}-title`}>{t("admin.agentKeys.journal.title", { name: journal.key.name })}</span>}>
            <p>{t("admin.agentKeys.journal.intro", { count: AGENT_KEY_LOG_SIZE })}</p>
            {journal.calls.length === 0 ? (
              <p>{t("admin.agentKeys.journal.none")}</p>
            ) : (
              <Table
                label={t("admin.agentKeys.journal.caption", { name: journal.key.name })}
                rows={journal.calls}
                rowKey={(call) => `${call.at.toISOString()} ${call.method} ${call.path}`}
                columns={callColumns}
              />
            )}
            <p>
              <Link prefetch={false} href={closeJournalHref}>
                {t("admin.agentKeys.journal.close")}
              </Link>
            </p>
          </Card>
        </section>
      ) : null}
    </>
  );
}
