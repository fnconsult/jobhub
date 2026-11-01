/**
 * Recipients outside the EU switched on in Paramètres that the privacy policy in effect does not name (#548, ADR-0064).
 * A new recipient outside the EU is a substantial change to the privacy policy: its new version, and the version's
 * 30-day notice, come before it is switched on in production. Paramètres never blocks it (an emergency switch must
 * stay possible): it warns, and writes a Back Office Audit line.
 *
 *   switchingOn(deps, () => save())                 runs a change; returns the Tools it switched on uncovered, each recorded
 *   uncoveredRecipient(tool, status, policy)        the warning a Tool's Outils page keeps while it is on and uncovered
 *
 * A Tool is a recipient outside the EU when it receives personal data, or queries drawn from it, outside the EU or
 * where that was not established (`isRecipientOutsideEu`). It is switched on when it can be called (`toolStatus`). The
 * Beta warns too, to be tested; the Recipient list only concerns production.
 */
import type { PrivacyPolicyCoverage } from "@jobhub/help";
import { isRecipientOutsideEu, TOOLS, type Tool } from "@jobhub/shared";
import type { BackOfficeChange } from "../admin/back-office";
import { toolStatus, type ToolsState, type ToolStatus } from "./index";

/** The statuses of a Tool that can be called: switched on. */
const SWITCHED_ON: readonly ToolStatus[] = ["configured", "no_key_needed", "awaiting_access"];

/** Whether `tool`, in `status`, is a recipient outside the EU switched on that the privacy policy in effect does not name. */
export function uncoveredRecipient(tool: Tool, status: ToolStatus, policy: PrivacyPolicyCoverage): boolean {
  return SWITCHED_ON.includes(status) && isRecipientOutsideEu(tool) && !policy.recipientsOutsideEu.includes(tool.id);
}

/** What `switchingOn` reads and writes through. */
export interface SwitchingOnDeps {
  /** The Tools' state now: read before the change, then after it. */
  state: () => Promise<ToolsState>;
  /** The privacy policy in effect today, and the recipients outside the EU it names. */
  policy: () => PrivacyPolicyCoverage;
  /** Writes the lines to the Back Office Audit. */
  record: (entries: readonly BackOfficeChange[]) => Promise<void>;
}

/**
 * Runs a Paramètres `change` (a Platform Setting, a Provider Secret, a Sign-in Provider) and returns its result with each
 * recipient outside the EU it switched on that the privacy policy in effect does not name, in the catalog's order, each
 * written to the Back Office Audit: the Tool, its residency, the policy version in effect (null before the first), « non
 * couvert ». A Tool already on, or left off, is not warned of again. A change that throws writes nothing.
 */
export async function switchingOn<T>(deps: SwitchingOnDeps, change: () => Promise<T>): Promise<{ result: T; uncovered: Tool[] }> {
  const before = await deps.state();
  const result = await change();
  const after = await deps.state();
  const policy = deps.policy();
  const wasOn = (tool: Tool) => SWITCHED_ON.includes(toolStatus(tool, before).status);
  const uncovered = (TOOLS as readonly Tool[]).filter((tool) => !wasOn(tool) && uncoveredRecipient(tool, toolStatus(tool, after).status, policy));
  if (uncovered.length > 0) await deps.record(uncovered.map((tool) => auditLine(tool, policy)));
  return { result, uncovered };
}

/** Its Back Office Audit line: section `recipients_outside_eu`, the Tool by its id, nothing before. */
function auditLine(tool: Tool, policy: PrivacyPolicyCoverage): BackOfficeChange {
  return {
    section: "recipients_outside_eu",
    target: tool.id,
    action: "switched_on",
    before: null,
    after: { residency: tool.residency, privacyPolicy: policy.version, coverage: "uncovered" },
  };
}
