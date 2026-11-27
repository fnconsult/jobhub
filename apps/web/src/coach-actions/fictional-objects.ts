/**
 * An Eval Case's fictional objects as the read Coach Actions find them (#714): the same reads as the app's, on no one's
 * data. Each object is given as its read tells it (`text`) with what the index shows of it; an id the case does not give,
 * or given with another type, is not_found. It keeps which objects were read, for the Eval Run to check: each by its id,
 * and by its type and id (« company_dossier:a1 »), since an Application's Company Dossier, Enriched Contacts and Coach
 * Reviews are read by the Application's id (ADR-0114).
 */
import { fitted, type CoachObjectReader, type IndexedObjectType, type ReadObjectType } from "./reads";

/** A fictional object of an Eval Case: never a real person's. */
export interface FictionalObject {
  type: ReadObjectType | Extract<IndexedObjectType, "agenda_item">;
  id: string;
  /** What the index shows of it. */
  title: string;
  status: string;
  /** As its read tells it. */
  text: string;
}

/**
 * Text the Candidate did not write: a Job Offer's, or an Application's, Job Search's or Job Digest's that shows one; a
 * Company Dossier, Enriched Contacts' names and roles, Coach Reviews (ADR-0114); Target Companies' names (#1157).
 */
const UNTRUSTED: readonly FictionalObject["type"][] = [
  "application",
  "job_offer",
  "job_search",
  "job_digest",
  "agenda_item",
  "company_dossier",
  "enriched_contacts",
  "coach_reviews",
  "target_companies",
];
const INDEXED: readonly FictionalObject["type"][] = ["profile", "application", "job_search", "job_digest", "agenda_item"];

export function fictionalObjects(objects: readonly FictionalObject[]): CoachObjectReader & { readIds(): string[] } {
  const read: string[] = [];
  return {
    async index() {
      return objects
        .filter((object) => INDEXED.includes(object.type))
        .map((object) => ({ type: object.type as IndexedObjectType, id: object.id, title: object.title, status: object.status, untrusted: UNTRUSTED.includes(object.type) }));
    },
    async read(_candidateId, type, id, maxTokens) {
      const object = objects.find((each) => each.id === id && each.type === type);
      if (!object) return null;
      for (const key of [id, `${type}:${id}`]) if (!read.includes(key)) read.push(key);
      return { text: fitted([object.text], maxTokens), pages: [], untrusted: UNTRUSTED.includes(object.type) };
    },
    readIds: () => [...read],
  };
}
