import { EFFORTS, type AgentModelChoice } from "@jobhub/ai";
import type { TaskPlaybookSeed } from "@jobhub/coach-knowledge/tasks";
import type { PlaybookKind, PlaybookVersion } from "@/coaching-playbooks";
import { agentModelValue, defaultModelLabel, effortOf, outsideEu } from "@/admin/playbook-form";
import { getServerT } from "@/i18n/server";

/**
 * The fields of a Playbook Version (#225): its rules, and for a Coaching Playbook its Playbook Agent's
 * model (those `models` offers: every text provider configured, an outside-EU one marked so), effort and
 * when to consult it. `version` prefills them. For a task Playbook (ADR-0026, `task` as the code knows it):
 * its instructions, with the sections and slots its task reads, and the model and effort running it (none
 * for a web-search query), which may be the model's own; no "when to consult it", the AI Coach never
 * consults it. A task Playbook that searches the web also has its « Moteur de recherche »: one of
 * `searchModels`, or none for the configured web-search route.
 */
export async function PlaybookVersionFields({
  idPrefix,
  kind,
  version,
  models,
  searchModels = [],
  task,
}: {
  idPrefix: string;
  kind: PlaybookKind;
  version?: PlaybookVersion;
  models: AgentModelChoice[];
  searchModels?: AgentModelChoice[];
  task?: TaskPlaybookSeed;
}) {
  const t = await getServerT();
  const agent = version?.agent ?? null;
  const current = agent ? agentModelValue(agent.provider, agent.model) : undefined;
  const offered = models.flatMap((choice) => [agentModelValue(choice.provider, null), ...choice.models.map((each) => agentModelValue(choice.provider, each.model))]);
  const search = version?.search ?? null;
  const currentSearch = search ? agentModelValue(search.provider, search.model) : "";
  const offeredSearch = searchModels.flatMap((choice) => [agentModelValue(choice.provider, null), ...choice.models.map((each) => agentModelValue(choice.provider, each.model))]);
  /** " (hors UE)" after a model that runs outside the EU. */
  const where = (choices: AgentModelChoice[], choice: AgentModelChoice, model: string | null) => (outsideEu(choices, choice.provider, model) ? ` (${t("admin.coachingPlaybooks.outsideEu")})` : "");
  const id = (field: string) => `${idPrefix}-${field}`;
  const isTask = kind === "task";
  const hasAgent = kind === "playbook" || (isTask && task?.agent !== false);
  const slots = isTask ? [...(task?.slots ?? []), ...(task?.sections ?? []).flatMap((section) => section.slots ?? [])] : [];
  const contentLabel = kind === "sources" ? "admin.coachingPlaybooks.fields.sourcesContent" : isTask ? "admin.coachingPlaybooks.fields.taskContent" : "admin.coachingPlaybooks.fields.content";
  const contentHelp = kind === "sources" ? "admin.coachingPlaybooks.fields.sourcesHelp" : isTask ? "admin.coachingPlaybooks.fields.taskContentHelp" : "admin.coachingPlaybooks.fields.contentHelp";
  return (
    <>
      <div className="stack">
        <label htmlFor={id("content")}>{t(contentLabel)}</label>
        <textarea id={id("content")} className="input" name="content" rows={18} required lang="fr" defaultValue={version?.content} aria-describedby={id("content-help")} />
        <div id={id("content-help")}>
          <p>{t(contentHelp)}</p>
          {task?.sections ? (
            <>
              <p>{t("admin.coachingPlaybooks.fields.taskSections")}</p>
              <ul>
                {task.sections.map((section) => (
                  <li key={section.key}>
                    <code>{`## ${section.key}`}</code> : <span lang="fr">{section.label}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {slots.length > 0 ? <p>{t("admin.coachingPlaybooks.fields.taskSlots", { slots: [...new Set(slots)].map((slot) => `{{${slot}}}`).join(", ") })}</p> : null}
        </div>
      </div>
      {hasAgent ? (
        <>
          <div className="stack">
            <label htmlFor={id("model")}>{t(isTask ? "admin.coachingPlaybooks.fields.taskModel" : "admin.coachingPlaybooks.fields.model")}</label>
            <select id={id("model")} className="input" name="agentModel" required defaultValue={current} aria-describedby={id("model-help")}>
              {/* A model no longer offered stays visible, so saving tells why it is refused rather than changing it silently. */}
              {current && !offered.includes(current) && agent ? <option value={current}>{`${agent.provider} · ${agent.model ?? t("admin.coachingPlaybooks.providerDefault")}`}</option> : null}
              {models.map((choice) => (
                <optgroup key={choice.provider} label={`${choice.provider} (${choice.endpoint})`}>
                  <option value={agentModelValue(choice.provider, null)}>
                    {`${choice.provider} · ${defaultModelLabel(t, choice)}${where(models, choice, null)}`}
                  </option>
                  {choice.models.map((each) => (
                    <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
                      {`${choice.provider} · ${each.model}${where(models, choice, each.model)}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p id={id("model-help")}>{t(isTask ? "admin.coachingPlaybooks.fields.taskModelHelp" : "admin.coachingPlaybooks.fields.modelHelp")}</p>
          </div>
          <div className="stack">
            <label htmlFor={id("effort")}>{t("admin.coachingPlaybooks.fields.effort")}</label>
            <select id={id("effort")} className="input" name="effort" required={!isTask} defaultValue={agent ? (agent.effort ?? "") : isTask ? "" : "medium"} aria-describedby={id("effort-help")}>
              {isTask ? <option value="">{t("admin.coachingPlaybooks.fields.effortNone")}</option> : null}
              {EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {t(`admin.coachingPlaybooks.efforts.${effort}`)}
                </option>
              ))}
            </select>
            <p id={id("effort-help")}>
              {t("admin.coachingPlaybooks.fields.effortHelp")}
              {agent && effortOf(models, agent.provider, agent.model) !== "native" ? ` (${t(`admin.coachingPlaybooks.effortHandling.${effortOf(models, agent.provider, agent.model)}`)})` : null}
            </p>
          </div>
          {isTask ? null : (
            <div className="stack">
              <label htmlFor={id("consult-when")}>{t("admin.coachingPlaybooks.fields.consultWhen")}</label>
              <textarea id={id("consult-when")} className="input" name="consultWhen" rows={3} required lang="fr" defaultValue={agent?.consultWhen} aria-describedby={id("consult-when-help")} />
              <p id={id("consult-when-help")}>{t("admin.coachingPlaybooks.fields.consultWhenHelp")}</p>
            </div>
          )}
        </>
      ) : null}
      {isTask && task?.search ? (
        <div className="stack">
          <label htmlFor={id("search-model")}>{t("admin.coachingPlaybooks.fields.searchModel")}</label>
          <select id={id("search-model")} className="input" name="searchModel" defaultValue={currentSearch} aria-describedby={id("search-model-help")}>
            <option value="">{t("admin.coachingPlaybooks.fields.searchConfigured")}</option>
            {/* A provider no longer offered stays visible, so saving tells why it is refused rather than changing it silently. */}
            {search && !offeredSearch.includes(currentSearch) ? <option value={currentSearch}>{`${search.provider} · ${search.model ?? t("admin.coachingPlaybooks.providerDefault")}`}</option> : null}
            {searchModels.map((choice) => (
              <optgroup key={choice.provider} label={`${choice.provider} (${choice.endpoint})`}>
                <option value={agentModelValue(choice.provider, null)}>
                  {`${choice.provider} · ${defaultModelLabel(t, choice)}${where(searchModels, choice, null)}`}
                </option>
                {choice.models.map((each) => (
                  <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
                    {`${choice.provider} · ${each.model}${where(searchModels, choice, each.model)}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p id={id("search-model-help")}>{t("admin.coachingPlaybooks.fields.searchModelHelp")}</p>
        </div>
      ) : null}
    </>
  );
}
