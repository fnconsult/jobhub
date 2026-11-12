import { candidateIdentityOf } from "@/candidate-identity";
import { helpSettings } from "@/coach-help/server";
import { sharedPool } from "@/database/pool";
import { createUnansweredQuestions, type UnansweredQuestions } from "./index";

let instance: UnansweredQuestions | undefined;

/** The app's Unanswered Questions (#344), on the database named by DATABASE_URL, redacted with what the AI layer knows of each Candidate. */
export function getUnansweredQuestions(): UnansweredQuestions {
  // A question is the help's miss against the Help Articles « Espace coach v2 » serves when it is asked (#867).
  instance ??= createUnansweredQuestions(sharedPool(), { identityOf: candidateIdentityOf(sharedPool()), helpSettings });
  return instance;
}
