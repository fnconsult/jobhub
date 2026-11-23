/**
 * What an AI Coach reply must never repeat (ADR-0114, « Périmètre du coach », check 4): the values of the identity block of
 * each of the Candidate's Master CVs (see privateIdentityOf) and the texts of the Private Coach Notes Human Coaches keep on
 * them. Read for the Guardrails only: never sent to any model, never kept.
 *
 *   createCoach({ ..., privateTexts: privateTextsOf(database, profiles) })
 */
import type { Queryable } from "../database/pool";
import { privateIdentityOf } from "../guardrails";
import type { Profiles } from "../profiles";

export function privateTextsOf(database: Queryable, profiles: Pick<Profiles, "list" | "get">) {
  return async (candidateId: string): Promise<{ identity: string[]; notes: string[] }> => {
    const summaries = await profiles.list(candidateId);
    const read = await Promise.all(summaries.map((profile) => profiles.get(candidateId, profile.id)));
    const identity = [...new Set(read.flatMap((profile) => (profile ? privateIdentityOf(profile.masterCv.content) : [])))];
    const { rows } = await database.query<{ text: string }>("SELECT text FROM private_coach_note WHERE candidate_id = $1 AND text <> ''", [candidateId]);
    return { identity, notes: rows.map((row) => row.text) };
  };
}
