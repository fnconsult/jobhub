import { candidateIdentityOf } from "@/candidate-identity";
import { sharedPool } from "@/database/pool";
import { createUnansweredQuestions, type UnansweredQuestions } from "./index";

let instance: UnansweredQuestions | undefined;

/** The app's Unanswered Questions (#344), on the database named by DATABASE_URL, redacted with what the AI layer knows of each Candidate. */
export function getUnansweredQuestions(): UnansweredQuestions {
  instance ??= createUnansweredQuestions(sharedPool(), { identityOf: candidateIdentityOf(sharedPool()) });
  return instance;
}
