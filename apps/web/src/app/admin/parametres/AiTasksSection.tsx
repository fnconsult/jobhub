import { EFFORTS, type AgentModelChoice, type Effort, type ProviderId } from "@jobhub/ai";
import { TOOLS, type Tool } from "@jobhub/shared";
import Link from "next/link";
import type { ReactNode } from "react";
import { agentModelValue, outsideEu } from "@/admin/playbook-form";
import type { PlaybookVersion } from "@/coaching-playbooks";
import { TEXT_PROVIDERS, type AiTaskRoute, type PlaybookAgentRow, type SearchTaskRow, type ValueSource } from "@/platform-settings/ai-tasks";
import { parametresHref } from "@/platform-settings/parametres";
import { routes } from "@/routes";
import { restoreRoute, savePlaybookAgent, saveRoute } from "./actions";
import { AddressDrawer } from "@/design/AddressDrawer";
import { buttonClass } from "@/design/button-class";
import { Select, TextInput } from "@/design/Field";
import { Note } from "@/design/Note";
import { Pill } from "@/design/Pill";
import { Table, type Column } from "@/design/Table";
import { Here, type Ctx } from "./context";
import { AI_FORM } from "./notices";
import { SOURCE_TONE } from "./tone";

/** The models each provider offers a Playbook Agent and a task Playbook's searches, with where each runs (#225): none when the AI layer cannot be built. */
export interface ModelChoices {
  agent: AgentModelChoice[];
  search: AgentModelChoice[];
}

/** A provider by its people's name: its first AI Tool's (Claude, Mistral…). */
const providerName = (provider: ProviderId): string => (TOOLS as readonly Tool[]).find((tool) => tool.usage?.table === "ai_usage" && tool.usage.provider === provider)?.name ?? provider;

/** « Mistral · mistral-small-latest », « Claude · modèle par défaut ». */
function runsOn(ctx: Ctx, provider: ProviderId, model: string | null): string {
  return `${providerName(provider)} · ${model ?? ctx.t("admin.platformSettings.aiTasks.providerDefault")}`;
}

/** Where a task's provider and model come from: a Platform Setting's source, or a version of its task Playbook. */
function SourceCell({ ctx, source }: { ctx: Ctx; source: ValueSource }) {
  if (source.kind === "playbook") return <Pill tone="accent">{ctx.t("admin.platformSettings.aiTasks.sourcePlaybook", { version: String(source.version) })}</Pill>;
  return <Pill tone={SOURCE_TONE[source.source]}>{ctx.t(`admin.platformSettings.sources.${source.source}`)}</Pill>;
}

/** Whether the provider's key is entered: a missing one is said, calls failing until it is. */
function KeyState({ ctx, missing }: { ctx: Ctx; missing: boolean }) {
  return <Pill tone={missing ? "danger" : "success"}>{ctx.t(missing ? "admin.platformSettings.aiTasks.keyMissing" : "admin.platformSettings.aiTasks.keySet")}</Pill>;
}

const effortLabel = (ctx: Ctx, effort: Effort | null): string => (effort ? ctx.t(`admin.coachingPlaybooks.efforts.${effort}`) : ctx.t("admin.platformSettings.aiTasks.effortNone"));

/** What marks the link that opens a task's or a Playbook Agent's panel, so closing it puts the focus back there. */
const opensPanel = (query: Record<string, string>) =>
  Object.entries(query)
    .map(([key, value]) => `${key}:${value}`)
    .join(" ");
const openerOf = (query: Record<string, string>) => `[data-opens-panel="${opensPanel(query)}"]`;

/** « Modifier… », opening a task's or a Playbook Agent's side panel on this tab. */
function EditLink({ ctx, query, name }: { ctx: Ctx; query: Record<string, string>; name: string }) {
  return (
    <Link
      prefetch={false}
      className={buttonClass({ size: "sm" })}
      href={parametresHref(ctx.tab.id, query)}
      aria-label={ctx.t("admin.platformSettings.aiTasks.editLabel", { name })}
      data-opens-panel={opensPanel(query)}
    >
      {ctx.t("admin.platformSettings.aiTasks.edit")}
    </Link>
  );
}

/**
 * Recherche web's « Tâches IA de la recherche » (#386, #402): the job title variants, the offer reading, a Company
 * Dossier's facts and news, each on what it runs now (provider · model · effort), where that comes from and whether the
 * provider's key is entered; « Modifier… » opens its Playbook Agent's side panel, the same as on the IA tab.
 */
export function SearchTasksSection({ ctx, rows, canEditPlaybooks }: { ctx: Ctx; rows: readonly SearchTaskRow[]; canEditPlaybooks: boolean }) {
  const { t } = ctx;
  const caption = t("admin.platformSettings.aiTasks.searchTitle");
  const columns: Column<SearchTaskRow>[] = [
    { key: "task", header: t("admin.platformSettings.aiTasks.columns.task"), rowHeader: true, cell: (row) => <span lang="fr">{row.title}</span> },
    { key: "role", header: t("admin.platformSettings.aiTasks.columns.role"), cell: (row) => t(`admin.platformSettings.aiTasks.roles.${row.id}`) },
    { key: "runsOn", header: t("admin.platformSettings.aiTasks.columns.runsOn"), cell: (row) => runsOn(ctx, row.provider, row.model) },
    { key: "effort", header: t("admin.platformSettings.aiTasks.columns.effort"), cell: (row) => effortLabel(ctx, row.effort) },
    { key: "source", header: t("admin.platformSettings.aiTasks.columns.source"), cell: (row) => <SourceCell ctx={ctx} source={row.source} /> },
    { key: "key", header: t("admin.platformSettings.aiTasks.columns.key"), cell: (row) => <KeyState ctx={ctx} missing={row.keyMissing} /> },
  ];
  if (canEditPlaybooks) {
    columns.push({
      key: "actions",
      header: t("admin.platformSettings.aiTasks.columns.actions"),
      cell: (row) => (row.playbook ? <EditLink ctx={ctx} query={{ [AI_FORM.playbook]: row.id }} name={row.title} /> : null),
    });
  }
  return (
    <section className="stack" aria-labelledby="search-tasks">
      <h2 id="search-tasks">{caption}</h2>
      <p>{t("admin.platformSettings.aiTasks.searchIntro")}</p>
      <Table label={caption} columns={columns} rows={rows} rowKey={(row) => row.id} rowAttributes={(row) => ({ "data-search-task": row.id })} />
    </section>
  );
}

/** A Playbook Version, as its row says it: number, and validated or a draft. */
function VersionCell({ ctx, row }: { ctx: Ctx; row: PlaybookAgentRow }) {
  const { t } = ctx;
  return (
    <>
      <p>{row.validated ? t("admin.platformSettings.aiTasks.validatedVersion", { version: String(row.validated.version) }) : t("admin.platformSettings.aiTasks.noValidated")}</p>
      {row.draft ? (
        <p>
          <span data-draft={row.draft.version}>
            <Pill tone="accent">{t("admin.platformSettings.aiTasks.draftVersion", { version: String(row.draft.version) })}</Pill>
          </span>
        </p>
      ) : null}
    </>
  );
}

/**
 * The IA tab's AI tasks (#402, ADR-0042): each text task's route, a Platform Setting changed in a side panel and applied
 * from the next call; then every Playbook Agent, whose model and effort belong to its Playbook Version: a change makes a
 * draft version, to validate in Playbooks. A provider whose key is missing is said, never refused.
 */
export function AiTasksSection({
  ctx,
  routes: taskRoutes,
  agents,
  canEditPlaybooks,
}: {
  ctx: Ctx;
  routes: readonly AiTaskRoute[];
  agents: readonly PlaybookAgentRow[] | null;
  canEditPlaybooks: boolean;
}) {
  const { t } = ctx;
  const routesCaption = t("admin.platformSettings.aiTasks.routesTitle");
  const agentsCaption = t("admin.platformSettings.aiTasks.agentsTitle");
  const routeColumns: Column<AiTaskRoute>[] = [
    { key: "task", header: t("admin.platformSettings.aiTasks.columns.task"), rowHeader: true, cell: (route) => t(`admin.aiUsage.tasks.${route.task}`) },
    { key: "runsOn", header: t("admin.platformSettings.aiTasks.columns.runsOn"), cell: (route) => runsOn(ctx, route.provider, route.model) },
    {
      key: "data",
      header: t("admin.platformSettings.aiTasks.columns.data"),
      cell: (route) => t(route.personalData ? "admin.platformSettings.aiTasks.personalData" : "admin.platformSettings.aiTasks.noPersonalData"),
    },
    { key: "source", header: t("admin.platformSettings.aiTasks.columns.source"), cell: (route) => <SourceCell ctx={ctx} source={route.source} /> },
    { key: "key", header: t("admin.platformSettings.aiTasks.columns.key"), cell: (route) => <KeyState ctx={ctx} missing={route.keyMissing} /> },
  ];
  if (ctx.can.settings) {
    routeColumns.push({
      key: "actions",
      header: t("admin.platformSettings.aiTasks.columns.actions"),
      cell: (route) => <EditLink ctx={ctx} query={{ [AI_FORM.task]: route.task }} name={t(`admin.aiUsage.tasks.${route.task}`)} />,
    });
  }
  const agentColumns: Column<PlaybookAgentRow>[] = [
    {
      key: "playbook",
      header: t("admin.platformSettings.aiTasks.columns.playbook"),
      rowHeader: true,
      cell: (row) => (
        <>
          <span lang="fr">{row.title}</span>
          <p>{t(`admin.platformSettings.aiTasks.kinds.${row.kind}`)}</p>
        </>
      ),
    },
    {
      key: "runsOn",
      header: t("admin.platformSettings.aiTasks.columns.runsOn"),
      cell: (row) => (row.agent ? runsOn(ctx, row.agent.provider, row.agent.model) : t("admin.platformSettings.providers.none")),
    },
    { key: "effort", header: t("admin.platformSettings.aiTasks.columns.effort"), cell: (row) => effortLabel(ctx, row.agent?.effort ?? null) },
    { key: "version", header: t("admin.platformSettings.aiTasks.columns.version"), cell: (row) => <VersionCell ctx={ctx} row={row} /> },
    { key: "key", header: t("admin.platformSettings.aiTasks.columns.key"), cell: (row) => <KeyState ctx={ctx} missing={row.keyMissing} /> },
  ];
  if (canEditPlaybooks) {
    agentColumns.push({ key: "actions", header: t("admin.platformSettings.aiTasks.columns.actions"), cell: (row) => <EditLink ctx={ctx} query={{ [AI_FORM.playbook]: row.id }} name={row.title} /> });
  }
  return (
    <>
      <section className="stack" aria-labelledby="ai-task-routes">
        <h2 id="ai-task-routes">{routesCaption}</h2>
        <p>{t("admin.platformSettings.aiTasks.routesIntro")}</p>
        <Table label={routesCaption} columns={routeColumns} rows={taskRoutes} rowKey={(route) => route.task} rowAttributes={(route) => ({ "data-ai-task": route.task })} />
      </section>

      <section className="stack" aria-labelledby="playbook-agents">
        <h2 id="playbook-agents">{agentsCaption}</h2>
        <p>{t("admin.platformSettings.aiTasks.agentsIntro")}</p>
        {agents === null ? (
          <p>{t("admin.platformSettings.aiTasks.agentsUnreadable")}</p>
        ) : (
          <Table label={agentsCaption} columns={agentColumns} rows={agents} rowKey={(row) => row.id} rowAttributes={(row) => ({ "data-playbook-agent": row.id })} />
        )}
      </section>
    </>
  );
}

/**
 * The side panel's frame, the Drawer the address opens (#465): its title, what kind of thing it is, what was just
 * done; « Fermer » back to the tab, the focus on the « Modifier… » that opened it.
 */
function Panel({ ctx, id, opener, kicker, title, notices, children }: { ctx: Ctx; id: string; opener: string; kicker: string; title: string; notices: ReactNode; children: ReactNode }) {
  return (
    <AddressDrawer title={title} closeHref={parametresHref(ctx.tab.id)} opener={opener} data-ai-panel={id}>
      <p className="parametres-kicker">{kicker}</p>
      {notices}
      {children}
    </AddressDrawer>
  );
}

/** Whether `provider`'s endpoint runs outside the EU, as the AI layer offers it; one not offered (no key) by its Tools. */
function providerOutsideEu(choices: readonly AgentModelChoice[], provider: ProviderId): boolean {
  const offered = choices.find((choice) => choice.provider === provider);
  if (offered) return offered.residency === "outside_eu";
  return !(TOOLS as readonly Tool[]).some((tool) => tool.usage?.table === "ai_usage" && tool.usage.provider === provider && tool.residency === "eu");
}

/**
 * An AI task's route in a side panel (#402): its provider (each said « hors UE » when it runs outside the EU, « clé
 * absente » without its key, still chosen) and model, saved as Platform Settings from the next call; « Rétablir le
 * défaut » clears both. A provider whose key is missing is warned of, and saved all the same (ADR-0042).
 */
export function RoutePanel({ ctx, route, choices, keyMissingOf, notices }: { ctx: Ctx; route: AiTaskRoute; choices: ModelChoices; keyMissingOf: (provider: ProviderId) => boolean; notices: ReactNode }) {
  const { t } = ctx;
  const name = t(`admin.aiUsage.tasks.${route.task}`);
  const known = choices.agent.find((choice) => choice.provider === route.provider)?.models.map((each) => each.model) ?? [];
  return (
    <Panel ctx={ctx} id="route-panel-title" opener={openerOf({ [AI_FORM.task]: route.task })} kicker={t("admin.platformSettings.aiTasks.routePanel.kicker")} title={name} notices={notices}>
      <p>
        <SourceCell ctx={ctx} source={route.source} /> <code>{route.providerSetting}</code>, <code>{route.modelSetting}</code>
      </p>
      {route.keyMissing ? (
        <Note tone="warn" role="status" data-key-warning="">
          <p>{t("admin.platformSettings.aiTasks.keyWarning", { provider: providerName(route.provider) })}</p>
        </Note>
      ) : null}
      <form className="stack" action={saveRoute}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.task} value={route.task} />
        <div className="stack">
          <label htmlFor="route-provider">{t("admin.platformSettings.aiTasks.routePanel.provider")}</label>
          <Select id="route-provider" name="provider" defaultValue={route.provider} aria-describedby="route-provider-help">
            {TEXT_PROVIDERS.map((provider) => {
              const marks = [
                ...(providerOutsideEu(choices.agent, provider) ? [t("admin.coachingPlaybooks.outsideEu")] : []),
                ...(keyMissingOf(provider) ? [t("admin.platformSettings.aiTasks.noKeyOption")] : []),
              ];
              return (
                <option key={provider} value={provider}>
                  {`${providerName(provider)}${marks.length > 0 ? ` (${marks.join(", ")})` : ""}`}
                </option>
              );
            })}
          </Select>
          <p id="route-provider-help">{t("admin.platformSettings.aiTasks.routePanel.providerHelp")}</p>
        </div>
        <div className="stack">
          <label htmlFor="route-model">{t("admin.platformSettings.aiTasks.routePanel.model")}</label>
          <TextInput id="route-model" name="model" type="text" list="route-models" defaultValue={route.model ?? ""} aria-describedby="route-model-help" />
          <datalist id="route-models">
            {known.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p id="route-model-help">{t("admin.platformSettings.aiTasks.routePanel.modelHelp")}</p>
        </div>
        <p>{t(route.euOnly ? "admin.platformSettings.aiTasks.routePanel.euOnly" : route.personalData ? "admin.platformSettings.aiTasks.routePanel.personalData" : "admin.platformSettings.aiTasks.routePanel.noPersonalData")}</p>
        <p>{t("admin.platformSettings.aiTasks.routePanel.applies")}</p>
        <button className={buttonClass({ variant: "primary" })} type="submit">
          {t("admin.platformSettings.save")}
        </button>
      </form>
      <form className="stack" action={restoreRoute}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.task} value={route.task} />
        <button className={buttonClass()} type="submit">
          {t("admin.platformSettings.aiTasks.routePanel.restore")}
        </button>
      </form>
      <p>
        <Link prefetch={false} href={routes.adminAiUsage()}>{t("admin.platformSettings.aiTasks.routePanel.usage")}</Link>
      </p>
    </Panel>
  );
}

/** The options of a model select: each provider's default model then its models, those outside the EU said so. */
function ModelOptions({ ctx, choices, current, label }: { ctx: Ctx; choices: AgentModelChoice[]; current: { provider: ProviderId; model: string | null } | null; label: (provider: ProviderId, model: string | null) => string }) {
  const where = (choice: AgentModelChoice, model: string | null) => (outsideEu(choices, choice.provider, model) ? ` (${ctx.t("admin.coachingPlaybooks.outsideEu")})` : "");
  const offered = choices.flatMap((choice) => [agentModelValue(choice.provider, null), ...choice.models.map((each) => agentModelValue(choice.provider, each.model))]);
  const value = current ? agentModelValue(current.provider, current.model) : undefined;
  return (
    <>
      {/* One no longer offered stays visible, so saving tells why it is refused rather than changing it silently. */}
      {current && value && !offered.includes(value) ? <option value={value}>{label(current.provider, current.model)}</option> : null}
      {choices.map((choice) => (
        <optgroup key={choice.provider} label={`${providerName(choice.provider)} (${choice.endpoint})`}>
          <option value={agentModelValue(choice.provider, null)}>{`${label(choice.provider, null)}${where(choice, null)}`}</option>
          {choice.models.map((each) => (
            <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
              {`${label(choice.provider, each.model)}${where(choice, each.model)}`}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * A Playbook Agent in a side panel (#402, ADR-0042): its model (every text provider configured, those outside the EU said
 * so) and effort, and for a task Playbook that searches, its web search's provider. Saving makes a draft Playbook Version
 * with the same rules (or updates the draft waiting for its validation): the validated version stays served in
 * production until another person validates the draft in Playbooks. Playbook editors only.
 */
export function PlaybookAgentPanel({ ctx, row, latest, choices, notices }: { ctx: Ctx; row: PlaybookAgentRow; latest: PlaybookVersion; choices: ModelChoices; notices: ReactNode }) {
  const { t } = ctx;
  const agent = latest.agent;
  const search = latest.search;
  const label = (provider: ProviderId, model: string | null) => runsOn(ctx, provider, model);
  const next = latest.validation ? latest.version + 1 : latest.version;
  return (
    <Panel ctx={ctx} id="playbook-panel-title" opener={openerOf({ [AI_FORM.playbook]: row.id })} kicker={t(`admin.platformSettings.aiTasks.kinds.${row.kind}`)} title={row.title} notices={notices}>
      <p>{row.served ? t("admin.platformSettings.aiTasks.playbookPanel.served", { version: String(row.served.version) }) : t("admin.platformSettings.aiTasks.playbookPanel.noServed")}</p>
      <VersionCell ctx={ctx} row={row} />
      {row.keyMissing && row.agent ? (
        <Note tone="warn" role="status" data-key-warning="">
          <p>{t("admin.platformSettings.aiTasks.agentKeyWarning", { provider: providerName(row.agent.provider) })}</p>
        </Note>
      ) : null}
      <form className="stack" action={savePlaybookAgent}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.playbook} value={row.id} />
        {agent ? (
          <>
            <div className="stack">
              <label htmlFor="agent-model">{t("admin.platformSettings.aiTasks.playbookPanel.model")}</label>
              <Select id="agent-model" name="agentModel" defaultValue={agentModelValue(agent.provider, agent.model)}>
                <ModelOptions ctx={ctx} choices={choices.agent} current={agent} label={label} />
              </Select>
            </div>
            <div className="stack">
              <label htmlFor="agent-effort">{t("admin.coachingPlaybooks.fields.effort")}</label>
              <Select id="agent-effort" name="effort" defaultValue={agent.effort ?? ""}>
                {row.kind === "task" ? <option value="">{t("admin.coachingPlaybooks.fields.effortNone")}</option> : null}
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {t(`admin.coachingPlaybooks.efforts.${effort}`)}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
        {row.searches ? (
          <div className="stack">
            <label htmlFor="agent-search">{t("admin.coachingPlaybooks.fields.searchModel")}</label>
            <Select id="agent-search" name="searchModel" defaultValue={search ? agentModelValue(search.provider, search.model) : ""}>
              <option value="">{t("admin.coachingPlaybooks.fields.searchConfigured")}</option>
              <ModelOptions ctx={ctx} choices={choices.search} current={search} label={label} />
            </Select>
          </div>
        ) : null}
        <p>
          {latest.validation
            ? t("admin.platformSettings.aiTasks.playbookPanel.createsDraft", { version: String(next) })
            : t("admin.platformSettings.aiTasks.playbookPanel.updatesDraft", { version: String(next) })}
        </p>
        <button className={buttonClass({ variant: "primary" })} type="submit">
          {latest.validation
            ? t("admin.platformSettings.aiTasks.playbookPanel.create", { version: String(next) })
            : t("admin.platformSettings.aiTasks.playbookPanel.update", { version: String(next) })}
        </button>
      </form>
      <p>
        <Link prefetch={false} href={routes.adminCoachingPlaybook(row.id)}>{t("admin.platformSettings.aiTasks.playbookPanel.open")}</Link>
      </p>
    </Panel>
  );
}
