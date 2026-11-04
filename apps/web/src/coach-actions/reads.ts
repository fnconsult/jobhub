/**
 * The read Coach Actions (#714, ADR-0077): how the AI Coach finds and reads an object of the Candidate that is not In view,
 * with the read scope of #654: active Profiles (Master CV without its Identity block, Search Criteria), Applications in full,
 * the Job Offers of their Job Searches, Job Digests and Applications with their Match Score, Job Searches, Job Digests, and
 * Tailored Documents as a summary only. Archived Profiles and their Applications are out of reach; the Coach Memory and the
 * Candidate summary are in the Coach context already.
 *
 *   readCoachActions(candidateObjects(sources))   // the shipped reads, over the domain modules the pages' routes use
 *   readCoachActions(fictionalObjects(objects))   // the same reads, over an Eval Case's fictional objects
 *
 * Each read is given `call.maxTokens`, the room left for its result (createCoachActions caps every result and the reply's
 * reads together): an object too long is shortened by rule, never by AI (a Master CV's job descriptions first), then cut.
 */
import * as z from "zod";
import type { CoachAction, CoachActionResult } from "./index";

/** What `list_objects` indexes. */
export const INDEXED_OBJECT_TYPES = ["profile", "application", "job_search", "job_digest", "agenda_item"] as const;
export type IndexedObjectType = (typeof INDEXED_OBJECT_TYPES)[number];

/** What a read reads, by id. */
export type ReadObjectType = "profile" | "application" | "job_offer" | "job_search" | "job_digest" | "tailored_documents";

/** One line of the index: no content, only what tells the object apart. */
export interface IndexedObject {
  type: IndexedObjectType;
  id: string;
  title: string;
  status: string;
  date?: Date;
  /** Its title holds text the Candidate did not write (a Job Offer's title, an employer). */
  untrusted?: boolean;
}

/** An object read, told as text within the room it was given. */
export interface ReadObject {
  text: string;
  /** The Candidate's pages it shows: the reply's Provenance sites. */
  pages: string[];
  /** It holds text the Candidate did not write (a Job Offer, a Company Dossier, an imported CV). */
  untrusted: boolean;
}

/**
 * Where the reads find the Candidate's objects (an internal seam): the domain modules (`candidateObjects`) or an Eval
 * Case's fictional objects. Scoped to `candidateId`: another Candidate's, an Archived Profile's or an unknown id is null.
 */
export interface CoachObjectReader {
  index(candidateId: string): Promise<IndexedObject[]>;
  read(candidateId: string, type: ReadObjectType, id: string, maxTokens: number): Promise<ReadObject | null>;
}

const id = z.string().min(1).max(200);

const found = (object: ReadObject | null): CoachActionResult => (object ? { ok: true, data: object.text, pages: object.pages, untrusted: object.untrusted } : { ok: false, error: "not_found" });

/** A read of one object by its id. */
const readOne = (reader: CoachObjectReader, name: string, type: ReadObjectType, group: CoachAction["group"], description: string): CoachAction =>
  ({
    name,
    description,
    schema: z.object({ id }),
    group,
    kind: "read",
    copiesText: false,
    run: async (args: { id: string }, call) => found(await reader.read(call.candidateId, type, args.id, call.maxTokens ?? Number.POSITIVE_INFINITY)),
  }) as unknown as CoachAction;

/** The read Coach Actions, over `reader`. */
export function readCoachActions(reader: CoachObjectReader): CoachAction[] {
  return [
    readOne(
      reader,
      "read_profile",
      "profile",
      "profile",
      "Lit un profil actif du candidat par son id : ses critères de recherche et son CV de référence (sans son identité).",
    ),
    readOne(
      reader,
      "read_application",
      "application",
      "applications",
      "Lit une candidature du candidat par son id : son statut, ses entretiens, son score de correspondance avec ses raisons et l'offre d'emploi.",
    ),
    readOne(
      reader,
      "read_job_offer",
      "job_offer",
      "job_searches",
      "Lit en entier une offre d'emploi par son id, si l'une des candidatures, recherches d'offres ou Job Digests du candidat la montre : son texte et son score de correspondance avec ses raisons.",
    ),
    readOne(
      reader,
      "read_job_search",
      "job_search",
      "job_searches",
      "Lit une recherche d'offres du candidat par son id : les offres trouvées, meilleur score d'abord, chacune avec son id et les raisons de son score.",
    ),
    readOne(
      reader,
      "read_job_digest",
      "job_digest",
      "job_digests",
      "Lit un Job Digest (sélection d'offres envoyée par e-mail) du candidat par son id : ses offres, meilleur score d'abord, chacune avec son id et les raisons de son score.",
    ),
    readOne(
      reader,
      "read_tailored_documents",
      "tailored_documents",
      "documents",
      "Résume les documents adaptés d'une candidature du candidat, par l'id de la candidature : CV adapté, lettre de motivation, message d'approche (dates, langue, longueur), jamais leur texte.",
    ),
  ];
}
