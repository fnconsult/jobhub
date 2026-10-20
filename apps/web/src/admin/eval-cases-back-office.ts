/**
 * A Coaching Playbook's Eval Cases' Back Office writes (ADR-0023, #231), each recorded in the Back Office Audit.
 *
 * `createEvalCasesBackOffice(evals, backOffice)` mirrors the Eval Cases' writes with the Administrator making
 * them: each runs through the Back Office's `record`, so the change and its entry share one transaction. A
 * refused or unchanged write records nothing. Every entry targets the Coaching Playbook and holds the case
 * before and after, in full: it is fictional, never personal data.
 */
import type { AddCaseResult, Evals, PlaybookEvalCase, RemoveCaseResult, SaveCaseResult } from "../evals";
import type { BackOffice, BackOfficeActor, BackOfficeChange, Recorded } from "./back-office";

export interface EvalCasesBackOffice {
  addCase(actor: BackOfficeActor, playbookId: string, input: unknown): Promise<AddCaseResult>;
  saveCase(actor: BackOfficeActor, playbookId: string, caseId: string, input: unknown): Promise<SaveCaseResult>;
  removeCase(actor: BackOfficeActor, playbookId: string, caseId: string): Promise<RemoveCaseResult>;
}

const SECTION = "eval_cases";

/** An Eval Case as recorded: its id and its whole text. */
const recordedCase = (evalCase: PlaybookEvalCase): { [key: string]: Recorded } => ({
  caseId: evalCase.id,
  title: evalCase.title,
  context: evalCase.context,
  message: evalCase.message,
  inViewKind: evalCase.inView?.kind ?? null,
  inViewText: evalCase.inView?.text ?? null,
  criteria: evalCase.criteria,
});

export function createEvalCasesBackOffice(evals: Pick<Evals, "addCase" | "saveCase" | "removeCase">, backOffice: Pick<BackOffice, "record">): EvalCasesBackOffice {
  return {
    addCase(actor, playbookId, input) {
      return backOffice.record(
        actor,
        (within) => evals.addCase(actor, playbookId, input, within),
        (added): BackOfficeChange | null => (added.ok ? { section: SECTION, target: playbookId, action: "added", before: null, after: recordedCase(added.evalCase) } : null),
      );
    },

    saveCase(actor, playbookId, caseId, input) {
      return backOffice.record(
        actor,
        (within) => evals.saveCase(actor, playbookId, caseId, input, within),
        (saved): BackOfficeChange | null => (saved.ok ? { section: SECTION, target: playbookId, action: "updated", before: recordedCase(saved.before), after: recordedCase(saved.evalCase) } : null),
      );
    },

    removeCase(actor, playbookId, caseId) {
      return backOffice.record(
        actor,
        (within) => evals.removeCase(playbookId, caseId, within),
        (removed): BackOfficeChange | null => (removed.ok ? { section: SECTION, target: playbookId, action: "removed", before: recordedCase(removed.before), after: null } : null),
      );
    },
  };
}
