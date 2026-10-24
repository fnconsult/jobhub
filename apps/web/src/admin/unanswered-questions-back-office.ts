/**
 * « Questions sans réponse » (#344): a Help editor's marks on the Unanswered Questions, each recorded in the Back Office Audit.
 *
 * `createUnansweredQuestionsBackOffice(questions, backOffice)` marks an open one « Article écrit » (written) or « Écarter »
 * (dismissed) through the Back Office's `record`, so the mark and its entry share one transaction. The entry's target is
 * the question, redacted as it is kept; nothing is recorded for one already marked, unknown, or a mark that is not one.
 */
import { isUnansweredQuestionMark, type UnansweredQuestions } from "../unanswered-questions";
import type { BackOffice, BackOfficeActor } from "./back-office";

export interface UnansweredQuestionsBackOffice {
  /** `status` is untrusted (a form's value): "written" or "dismissed". Whether an open one was marked. */
  mark(actor: BackOfficeActor, id: string, status: unknown): Promise<boolean>;
}

export function createUnansweredQuestionsBackOffice(questions: Pick<UnansweredQuestions, "mark">, backOffice: Pick<BackOffice, "record">): UnansweredQuestionsBackOffice {
  return {
    async mark(actor, id, status) {
      if (!isUnansweredQuestionMark(status)) return false;
      const marked = await backOffice.record(
        actor,
        (within) => questions.mark(id, status, within),
        (done) =>
          done
            ? { section: "unanswered_questions", target: done.after.question, action: "updated", before: { status: done.before.status }, after: { status: done.after.status } }
            : null,
      );
      return marked !== null;
    },
  };
}
