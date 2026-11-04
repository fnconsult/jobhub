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
import { estimateTokens } from "../coach/context";
import type { CoachAction, CoachActionCall, CoachActionResult } from "./index";

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

const CUT = " […] (la suite est coupée)";

/** The first of `tellings` (fullest first) within `maxTokens`, else the last one cut to fit. */
export function fitted(tellings: readonly string[], maxTokens: number): string {
  const fits = tellings.find((text) => estimateTokens(text) <= maxTokens);
  if (fits !== undefined) return fits;
  const last = tellings.at(-1) ?? "";
  return last.slice(0, Math.max(0, maxTokens * 4 - CUT.length)) + CUT;
}

/** `head` and as many of `lines` as fit in `maxTokens`, the first ones kept, saying how many were left out by `left(n)`. */
export function fittedLines(head: string, lines: readonly string[], maxTokens: number, left: (count: number) => string): string {
  const told = (count: number) => [head, ...lines.slice(0, count), ...(count < lines.length ? [left(lines.length - count)] : [])].join("\n");
  let count = lines.length;
  while (count > 0 && estimateTokens(told(count)) > maxTokens) count -= 1;
  return fitted([told(count)], maxTokens);
}

const id = z.string().min(1).max(200);

/** Text compared without case nor accents. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const indexLine = (object: IndexedObject) => `- ${object.type} ${object.id} · ${object.title} · ${object.status}${object.date ? ` · ${object.date.toISOString().slice(0, 10)}` : ""}`;

/** The index of the Candidate's objects, filtered by type and text: what tells each apart, never its content. */
const listObjects = (reader: CoachObjectReader): CoachAction =>
  ({
    name: "list_objects",
    description:
      "Liste les objets du candidat, sans leur contenu (type, id, titre, statut, date) : profils actifs, candidatures, recherches d'offres, Job Digests et rendez-vous de l'agenda. Filtre par type et par texte (dans le titre ou le statut). Sers-t'en pour trouver l'id d'un objet qui n'est pas affiché, puis lis-le.",
    schema: z.object({ type: z.enum(INDEXED_OBJECT_TYPES).optional(), text: z.string().max(200).optional() }),
    group: "applications",
    kind: "read",
    copiesText: false,
    async run(args: { type?: IndexedObjectType; text?: string }, call: CoachActionCall) {
      const text = folded(args.text?.trim() ?? "");
      const shown = (await reader.index(call.candidateId)).filter(
        (object) => (!args.type || object.type === args.type) && (!text || folded(`${object.title} ${object.status}`).includes(text)),
      );
      if (shown.length === 0) return { ok: true, data: "Aucun objet ne correspond." };
      const told = fittedLines(
        "Objets du candidat (type, id, titre, statut, date) :",
        shown.map(indexLine),
        call.maxTokens ?? Number.POSITIVE_INFINITY,
        (count) => `(${count} autres objets ne sont pas montrés : filtre par type ou par texte.)`,
      );
      // Only what is shown counts: a Job Offer's title or employer is text the Candidate did not write.
      const lines = told.split("\n").filter((line) => line.startsWith("- ")).length;
      return { ok: true, data: told, untrusted: shown.slice(0, lines).some((object) => object.untrusted) };
    },
  }) as unknown as CoachAction;

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
    run: async (args: { id: string }, call: CoachActionCall) => found(await reader.read(call.candidateId, type, args.id, call.maxTokens ?? Number.POSITIVE_INFINITY)),
  }) as unknown as CoachAction;

/** The read Coach Actions, over `reader`. */
export function readCoachActions(reader: CoachObjectReader): CoachAction[] {
  return [
    listObjects(reader),
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
