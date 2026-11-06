/**
 * A CV joined to the conversation, read and kept as the web's form does (apps/web/src/components/CvDraftForms.tsx):
 * `POST /api/cv/draft` reads the file (multipart field "cv") into a draft Master CV and Search Criteria and saves
 * nothing; `POST /api/profiles` saves the draft as a new Profile. Aborting `signal` is « Arrêter »: the server aborts the
 * reading and nothing is drafted. Never throws: every way it can end is an outcome.
 */
import type { MasterCvContent } from "@jobhub/shared";
import type { ApiFetch } from "../api/api";
import type { GivenFile } from "./attachment";

/** What the server read in a CV: what a new Profile is saved from. */
export type CvDraft = {
  masterCv: MasterCvContent;
  searchCriteria: { targetRole: string; locations: string[] };
  /** What read it, when the AI Coach did (#335): kept with the Master CV's first version. */
  provenance?: unknown;
};

/** Why the server could not read a CV: its own codes (CvFileErrorCode), "unknown" for anything else. */
export type CvReadingError = "unsupported_format" | "too_large" | "unreadable" | "empty" | "unknown";

const READING_ERRORS = new Set<string>(["unsupported_format", "too_large", "unreadable", "empty"]);

export type CvReading = { kind: "draft"; draft: CvDraft } | { kind: "refused"; error: CvReadingError } | { kind: "stopped" };

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const typeOf = (file: GivenFile) => file.mimeType || (file.name.toLowerCase().endsWith(".docx") ? DOCX : "application/pdf");

export async function readCv(api: ApiFetch, file: GivenFile, { signal }: { signal?: AbortSignal } = {}): Promise<CvReading> {
  const form = new FormData();
  // React Native's FormData sends the file at `uri` itself, under its name and type.
  form.append("cv", { uri: file.uri, name: file.name, type: typeOf(file) } as unknown as Blob);
  try {
    const response = await api("/api/cv/draft", { method: "POST", body: form, ...(signal ? { signal } : {}) });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { kind: "draft", draft: body as unknown as CvDraft };
    if (body.error === "stopped") return { kind: "stopped" };
    return { kind: "refused", error: READING_ERRORS.has(String(body.error)) ? (body.error as CvReadingError) : "unknown" };
  } catch {
    return signal?.aborted ? { kind: "stopped" } : { kind: "refused", error: "unknown" };
  }
}

/** How saving a draft as a Profile ended: its id; the fields the server wants filled; the Plan Quota reached; or no answer. */
export type ProfileCreation = { kind: "created"; id: string } | { kind: "incomplete"; fields: string[] } | { kind: "quotaReached" } | { kind: "failed" };

export async function createProfile(api: ApiFetch, draft: CvDraft): Promise<ProfileCreation> {
  try {
    const response = await api("/api/profiles", {
      method: "POST",
      body: JSON.stringify({
        masterCv: draft.masterCv,
        // The places alone: the server's `location` is a copy of the first for earlier extensions (ADR-0025).
        searchCriteria: { targetRole: draft.searchCriteria.targetRole, locations: draft.searchCriteria.locations },
        ...(draft.provenance ? { provenance: draft.provenance } : {}),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: unknown; errors?: unknown; error?: unknown };
    if (response.status === 201 && typeof body.id === "string") return { kind: "created", id: body.id };
    if (body.error === "plan_quota_reached") return { kind: "quotaReached" };
    if (Array.isArray(body.errors)) return { kind: "incomplete", fields: [...new Set(body.errors.map((error: { field?: unknown }) => String(error.field)))] };
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}
