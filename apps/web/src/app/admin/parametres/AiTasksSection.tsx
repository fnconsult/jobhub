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
import { Here, ScrollFrame, type Ctx } from "./context";
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
  if (source.kind === "playbook") {
    return (
      <span className="pill" data-tone="accent">
        {ctx.t("admin.platformSettings.aiTasks.sourcePlaybook", { version: String(source.version) })}
      </span>
    );
  }
  return (
    <span className="pill" data-tone={SOURCE_TONE[source.source]}>
      {ctx.t(`admin.platformSettings.sources.${source.source}`)}
    </span>
  );
}

/** Whether the provider's key is entered: a missing one is said, calls failing until it is. */
function KeyState({ ctx, missing }: { ctx: Ctx; missing: boolean }) {
  return (
    <span className="pill" data-tone={missing ? "danger" : "success"}>
      {ctx.t(missing ? "admin.platformSettings.aiTasks.keyMissing" : "admin.platformSettings.aiTasks.keySet")}
    </span>
  );
}

const effortLabel = (ctx: Ctx, effort: Effort | null): string => (effort ? ctx.t(`admin.coachingPlaybooks.efforts.${effort}`) : ctx.t("admin.platformSettings.aiTasks.effortNone"));

/** « Modifier… », opening a task's or a Playbook Agent's side panel on this tab. */
function EditLink({ ctx, query, name }: { ctx: Ctx; query: Record<string, string>; name: string }) {
  return (
    <Link prefetch={false} className="button" href={parametresHref(ctx.tab.id, query)} aria-label={ctx.t("admin.platformSettings.aiTasks.editLabel", { name })}>
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
  return (
    <section className="stack" aria-labelledby="search-tasks">
      <h2 id="search-tasks">{caption}</h2>
      <p>{t("admin.platformSettings.aiTasks.searchIntro")}</p>
      <ScrollFrame label={caption}>
        <table className="application-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.task")}</th>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.role")}</th>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.runsOn")}</th>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.effort")}</th>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.source")}</th>
              <th scope="col">{t("admin.platformSettings.aiTasks.columns.key")}</th>
              {canEditPlaybooks ? <th scope="col">{t("admin.platformSettings.aiTasks.columns.actions")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-search-task={row.id}>
                <th scope="row" lang="fr">
                  {row.title}
                </th>
                <td>{t(`admin.platformSettings.aiTasks.roles.${row.id}`)}</td>
                <td>{runsOn(ctx, row.provider, row.model)}</td>
                <td>{effortLabel(ctx, row.effort)}</td>
                <td>
                  <SourceCell ctx={ctx} source={row.source} />
                </td>
                <td>
                  <KeyState ctx={ctx} missing={row.keyMissing} />
                </td>
                {canEditPlaybooks ? <td>{row.playbook ? <EditLink ctx={ctx} query={{ [AI_FORM.playbook]: row.id }} name={row.title} /> : null}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFrame>
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
          <span className="pill" data-tone="accent" data-draft={row.draft.version}>
            {t("admin.platformSettings.aiTasks.draftVersion", { version: String(row.draft.version) })}
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
  return (
    <>
      <section className="stack" aria-labelledby="ai-task-routes">
        <h2 id="ai-task-routes">{routesCaption}</h2>
        <p>{t("admin.platformSettings.aiTasks.routesIntro")}</p>
        <ScrollFrame label={routesCaption}>
          <table className="application-table">
            <caption className="visually-hidden">{routesCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.platformSettings.aiTasks.columns.task")}</th>
                <th scope="col">{t("admin.platformSettings.aiTasks.columns.runsOn")}</th>
                <th scope="col">{t("admin.platformSettings.aiTasks.columns.data")}</th>
                <th scope="col">{t("admin.platformSettings.aiTasks.columns.source")}</th>
                <th scope="col">{t("admin.platformSettings.aiTasks.columns.key")}</th>
                {ctx.can.settings ? <th scope="col">{t("admin.platformSettings.aiTasks.columns.actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {taskRoutes.map((route) => (
                <tr key={route.task} data-ai-task={route.task}>
                  <th scope="row">{t(`admin.aiUsage.tasks.${route.task}`)}</th>
                  <td>{runsOn(ctx, route.provider, route.model)}</td>
                  <td>{t(route.personalData ? "admin.platformSettings.aiTasks.personalData" : "admin.platformSettings.aiTasks.noPersonalData")}</td>
                  <td>
                    <SourceCell ctx={ctx} source={route.source} />
                  </td>
                  <td>
                    <KeyState ctx={ctx} missing={route.keyMissing} />
                  </td>
                  {ctx.can.settings ? (
                    <td>
                      <EditLink ctx={ctx} query={{ [AI_FORM.task]: route.task }} name={t(`admin.aiUsage.tasks.${route.task}`)} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      </section>

      <section className="stack" aria-labelledby="playbook-agents">
        <h2 id="playbook-agents">{agentsCaption}</h2>
        <p>{t("admin.platformSettings.aiTasks.agentsIntro")}</p>
        {agents === null ? (
          <p>{t("admin.platformSettings.aiTasks.agentsUnreadable")}</p>
        ) : (
          <ScrollFrame label={agentsCaption}>
            <table className="application-table">
              <caption className="visually-hidden">{agentsCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("admin.platformSettings.aiTasks.columns.playbook")}</th>
                  <th scope="col">{t("admin.platformSettings.aiTasks.columns.runsOn")}</th>
                  <th scope="col">{t("admin.platformSettings.aiTasks.columns.effort")}</th>
                  <th scope="col">{t("admin.platformSettings.aiTasks.columns.version")}</th>
                  <th scope="col">{t("admin.platformSettings.aiTasks.columns.key")}</th>
                  {canEditPlaybooks ? <th scope="col">{t("admin.platformSettings.aiTasks.columns.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {agents.map((row) => (
                  <tr key={row.id} data-playbook-agent={row.id}>
                    <th scope="row">
                      <span lang="fr">{row.title}</span>
                      <p>{t(`admin.platformSettings.aiTasks.kinds.${row.kind}`)}</p>
                    </th>
                    <td>{row.agent ? runsOn(ctx, row.agent.provider, row.agent.model) : t("admin.platformSettings.providers.none")}</td>
                    <td>{effortLabel(ctx, row.agent?.effort ?? null)}</td>
                    <td>
                      <VersionCell ctx={ctx} row={row} />
                    </td>
                    <td>
                      <KeyState ctx={ctx} missing={row.keyMissing} />
                    </td>
                    {canEditPlaybooks ? (
                      <td>
                        <EditLink ctx={ctx} query={{ [AI_FORM.playbook]: row.id }} name={row.title} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </section>
    </>
  );
}

/** The side panel's frame: its title, « Fermer » back to the tab, and what was just done. */
function Panel({ ctx, id, kicker, title, notices, children }: { ctx: Ctx; id: string; kicker: string; title: string; notices: ReactNode; children: ReactNode }) {
  return (
    <aside className="side-sheet stack" aria-labelledby={id} data-ai-panel={id}>
      <div className="side-sheet-head">
        <div>
          <p>{kicker}</p>
          <h2 id={id}>{title}</h2>
        </div>
        <Link prefetch={false} className="button" href={parametresHref(ctx.tab.id)}>
          {ctx.t("admin.platformSettings.sheet.close")}
        </Link>
      </div>
      {notices}
      {children}
    </aside>
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
    <Panel ctx={ctx} id="route-panel-title" kicker={t("admin.platformSettings.aiTasks.routePanel.kicker")} title={name} notices={notices}>
      <p>
        <SourceCell ctx={ctx} source={route.source} /> <code>{route.providerSetting}</code>, <code>{route.modelSetting}</code>
      </p>
      {route.keyMissing ? (
        <p className="notice" role="status" data-key-warning>
          {t("admin.platformSettings.aiTasks.keyWarning", { provider: providerName(route.provider) })}
        </p>
      ) : null}
      <form className="stack" action={saveRoute}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.task} value={route.task} />
        <div className="stack">
          <label htmlFor="route-provider">{t("admin.platformSettings.aiTasks.routePanel.provider")}</label>
          <select id="route-provider" className="input" name="provider" defaultValue={route.provider} aria-describedby="route-provider-help">
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
          </select>
          <p id="route-provider-help">{t("admin.platformSettings.aiTasks.routePanel.providerHelp")}</p>
        </div>
        <div className="stack">
          <label htmlFor="route-model">{t("admin.platformSettings.aiTasks.routePanel.model")}</label>
          <input id="route-model" className="input" name="model" type="text" list="route-models" defaultValue={route.model ?? ""} aria-describedby="route-model-help" />
          <datalist id="route-models">
            {known.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <p id="route-model-help">{t("admin.platformSettings.aiTasks.routePanel.modelHelp")}</p>
        </div>
        <p>{t(route.personalData ? "admin.platformSettings.aiTasks.routePanel.personalData" : "admin.platformSettings.aiTasks.routePanel.noPersonalData")}</p>
        <p>{t("admin.platformSettings.aiTasks.routePanel.applies")}</p>
        <button className="button button-primary" type="submit">
          {t("admin.platformSettings.save")}
        </button>
      </form>
      <form className="stack" action={restoreRoute}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.task} value={route.task} />
        <button className="button" type="submit">
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
    <Panel ctx={ctx} id="playbook-panel-title" kicker={t(`admin.platformSettings.aiTasks.kinds.${row.kind}`)} title={row.title} notices={notices}>
      <p>{row.served ? t("admin.platformSettings.aiTasks.playbookPanel.served", { version: String(row.served.version) }) : t("admin.platformSettings.aiTasks.playbookPanel.noServed")}</p>
      <VersionCell ctx={ctx} row={row} />
      {row.keyMissing && row.agent ? (
        <p className="notice" role="status" data-key-warning>
          {t("admin.platformSettings.aiTasks.agentKeyWarning", { provider: providerName(row.agent.provider) })}
        </p>
      ) : null}
      <form className="stack" action={savePlaybookAgent}>
        <Here ctx={ctx} />
        <input type="hidden" name={AI_FORM.playbook} value={row.id} />
        {agent ? (
          <>
            <div className="stack">
              <label htmlFor="agent-model">{t("admin.platformSettings.aiTasks.playbookPanel.model")}</label>
              <select id="agent-model" className="input" name="agentModel" defaultValue={agentModelValue(agent.provider, agent.model)}>
                <ModelOptions ctx={ctx} choices={choices.agent} current={agent} label={label} />
              </select>
            </div>
            <div className="stack">
              <label htmlFor="agent-effort">{t("admin.coachingPlaybooks.fields.effort")}</label>
              <select id="agent-effort" className="input" name="effort" defaultValue={agent.effort ?? ""}>
                {row.kind === "task" ? <option value="">{t("admin.coachingPlaybooks.fields.effortNone")}</option> : null}
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {t(`admin.coachingPlaybooks.efforts.${effort}`)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        {row.searches ? (
          <div className="stack">
            <label htmlFor="agent-search">{t("admin.coachingPlaybooks.fields.searchModel")}</label>
            <select id="agent-search" className="input" name="searchModel" defaultValue={search ? agentModelValue(search.provider, search.model) : ""}>
              <option value="">{t("admin.coachingPlaybooks.fields.searchConfigured")}</option>
              <ModelOptions ctx={ctx} choices={choices.search} current={search} label={label} />
            </select>
          </div>
        ) : null}
        <p>{latest.validation ? t("admin.platformSettings.aiTasks.playbookPanel.createsDraft", { version: String(next) }) : t("admin.platformSettings.aiTasks.playbookPanel.updatesDraft", { version: String(next) })}</p>
        <button className="button button-primary" type="submit">
          {latest.validation ? t("admin.platformSettings.aiTasks.playbookPanel.create", { version: String(next) }) : t("admin.platformSettings.aiTasks.playbookPanel.update", { version: String(next) })}
        </button>
      </form>
      <p>
        <Link prefetch={false} href={routes.adminCoachingPlaybook(row.id)}>{t("admin.platformSettings.aiTasks.playbookPanel.open")}</Link>
      </p>
    </Panel>
  );
}
