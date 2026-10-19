/** Test doubles for task Playbooks (ADR-0026): a reader serving the versions a test gives. */
import type { Effort, ProviderId } from "@jobhub/ai";
import type { PlaybookAgent } from "../coaching-playbooks";
import type { TaskPlaybookId, TaskPlaybookReader } from "./index";

/** A task Playbook's Playbook Agent on `provider`'s `model` (the fake providers' default is `fake-<id>`). */
export const taskAgent = (provider: ProviderId, model: string | null = `fake-${provider}`, effort: Effort | null = null): PlaybookAgent => ({ provider, model, effort, consultWhen: "" });

/** Serves, for each id given, that text as version 2 run by that agent (none: no Playbook Agent); nothing for any other id. */
export function servedTasks(served: Partial<Record<TaskPlaybookId, { content: string; agent?: PlaybookAgent | null }>>): TaskPlaybookReader & { reads: string[] } {
  const reads: string[] = [];
  const reader = async (id: TaskPlaybookId) => {
    reads.push(id);
    const version = served[id];
    return version ? { id, version: 2, content: version.content, agent: version.agent ?? null } : null;
  };
  return Object.assign(reader, { reads });
}
