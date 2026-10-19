import { EFFORTS, type AgentModelChoice } from "@jobhub/ai";
import type { PlaybookKind, PlaybookVersion } from "@/coaching-playbooks";
import { agentModelValue, effortOf } from "@/admin/playbook-form";
import { getServerT } from "@/i18n/server";

/**
 * The fields of a Playbook Version (#225): its rules, and for a Coaching Playbook its Playbook Agent's
 * model (only those `models` offers: EU-resident), effort and when to consult it. `version` prefills them.
 */
export async function PlaybookVersionFields({ idPrefix, kind, version, models }: { idPrefix: string; kind: PlaybookKind; version?: PlaybookVersion; models: AgentModelChoice[] }) {
  const t = await getServerT();
  const agent = version?.agent ?? null;
  const current = agent ? agentModelValue(agent.provider, agent.model) : undefined;
  const offered = models.flatMap((choice) => [agentModelValue(choice.provider, null), ...choice.models.map((each) => agentModelValue(choice.provider, each.model))]);
  const id = (field: string) => `${idPrefix}-${field}`;
  return (
    <>
      <div className="stack">
        <label htmlFor={id("content")}>{t(kind === "sources" ? "admin.coachingPlaybooks.fields.sourcesContent" : "admin.coachingPlaybooks.fields.content")}</label>
        <textarea id={id("content")} className="input" name="content" rows={18} required lang="fr" defaultValue={version?.content} aria-describedby={id("content-help")} />
        <p id={id("content-help")}>{t(kind === "sources" ? "admin.coachingPlaybooks.fields.sourcesHelp" : "admin.coachingPlaybooks.fields.contentHelp")}</p>
      </div>
      {kind === "playbook" ? (
        <>
          <div className="stack">
            <label htmlFor={id("model")}>{t("admin.coachingPlaybooks.fields.model")}</label>
            <select id={id("model")} className="input" name="agentModel" required defaultValue={current} aria-describedby={id("model-help")}>
              {/* A model no longer offered stays visible, so saving tells why it is refused rather than changing it silently. */}
              {current && !offered.includes(current) && agent ? <option value={current}>{`${agent.provider} · ${agent.model ?? t("admin.coachingPlaybooks.providerDefault")}`}</option> : null}
              {models.map((choice) => (
                <optgroup key={choice.provider} label={`${choice.provider} (${choice.endpoint})`}>
                  <option value={agentModelValue(choice.provider, null)}>
                    {`${choice.provider} · ${t("admin.coachingPlaybooks.defaultModel", { model: choice.defaultModel ?? "?" })}`}
                  </option>
                  {choice.models.map((each) => (
                    <option key={each.model} value={agentModelValue(choice.provider, each.model)}>
                      {`${choice.provider} · ${each.model}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p id={id("model-help")}>{t("admin.coachingPlaybooks.fields.modelHelp")}</p>
          </div>
          <div className="stack">
            <label htmlFor={id("effort")}>{t("admin.coachingPlaybooks.fields.effort")}</label>
            <select id={id("effort")} className="input" name="effort" required defaultValue={agent?.effort ?? "medium"} aria-describedby={id("effort-help")}>
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
          <div className="stack">
            <label htmlFor={id("consult-when")}>{t("admin.coachingPlaybooks.fields.consultWhen")}</label>
            <textarea id={id("consult-when")} className="input" name="consultWhen" rows={3} required lang="fr" defaultValue={agent?.consultWhen} aria-describedby={id("consult-when-help")} />
            <p id={id("consult-when-help")}>{t("admin.coachingPlaybooks.fields.consultWhenHelp")}</p>
          </div>
        </>
      ) : null}
    </>
  );
}
