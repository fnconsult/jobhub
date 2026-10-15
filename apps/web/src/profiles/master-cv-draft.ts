import type { MasterCvContent } from "@jobhub/shared";

/** The parts of a Master CV the Profile page edits in place, as its fields hold them. */
export interface CvDocumentFields {
  headline: string;
  summary: string;
  /** One per job, in the CV's order. */
  descriptions: string[];
  /** One skill per line. */
  skills: string;
}

/**
 * The Candidate's edits of a Master CV on the Profile page. They accumulate
 * until the Candidate saves them as one new version, based on the version they
 * edited (ADR-0012), or cancels them.
 */
export interface MasterCvDraft {
  /** The version the edits are based on. */
  basedOnVersion: number;
  /** The version a save would create. */
  nextVersion: number;
  /** The content of `basedOnVersion`. */
  saved: MasterCvContent;
  fields: CvDocumentFields;
  /** What the last save said, or "editing" since the last edit. */
  status: MasterCvDraftStatus;
}

export type MasterCvDraftStatus =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "saved"; version: number }
  /** Another save (another tab, another device) made the version edited outdated. Nothing was overwritten. */
  | { kind: "conflict"; currentVersion: number }
  | { kind: "invalid" }
  | { kind: "failed" };

export type MasterCvDraftEvent =
  | { type: "edit"; changes: Partial<CvDocumentFields> }
  | { type: "cancel" }
  | { type: "save" }
  /** The server's answer to the save: its HTTP status and JSON body. */
  | { type: "answered"; status: number; body: unknown }
  /** The save could not reach the server. */
  | { type: "failed" }
  /** The page shows this version of the Master CV (e.g. after an accepted ATS Fix saved one). */
  | { type: "loaded"; version: number; content: MasterCvContent };

export function startDraft(version: number, content: MasterCvContent): MasterCvDraft {
  return { basedOnVersion: version, nextVersion: version + 1, saved: content, fields: fieldsOf(content), status: { kind: "editing" } };
}

export function nextDraft(draft: MasterCvDraft, event: MasterCvDraftEvent): MasterCvDraft {
  switch (event.type) {
    case "edit":
      return { ...draft, fields: { ...draft.fields, ...event.changes }, status: { kind: "editing" } };
    case "cancel":
      return startDraft(draft.basedOnVersion, draft.saved);
    case "save":
      return { ...draft, status: { kind: "saving" } };
    case "failed":
      return { ...draft, status: { kind: "failed" } };
    case "answered":
      return answered(draft, event.status, event.body);
    case "loaded":
      return event.version === draft.basedOnVersion || isDirty(draft) ? draft : startDraft(event.version, event.content);
  }
}

function answered(draft: MasterCvDraft, status: number, body: unknown): MasterCvDraft {
  const field = (name: string) => (body && typeof body === "object" && name in body ? (body as Record<string, unknown>)[name] : undefined);
  const version = field("version");
  const currentVersion = field("currentVersion");
  if (status === 200 && typeof version === "number") return { ...startDraft(version, contentOf(draft)), status: { kind: "saved", version } };
  if (status === 409 && typeof currentVersion === "number") return { ...draft, status: { kind: "conflict", currentVersion } };
  return { ...draft, status: { kind: status === 400 ? "invalid" : "failed" } };
}

/** Whether saving would change the Master CV (saving without changes creates no version). */
export function isDirty(draft: MasterCvDraft): boolean {
  return JSON.stringify(contentOf(draft)) !== JSON.stringify(draft.saved);
}

/** The body of the save: the edited content and the version it is based on. */
export function saveRequest(draft: MasterCvDraft): { basedOnVersion: number; content: MasterCvContent } {
  return { basedOnVersion: draft.basedOnVersion, content: contentOf(draft) };
}

function fieldsOf(content: MasterCvContent): CvDocumentFields {
  return {
    headline: content.headline,
    summary: content.summary,
    descriptions: content.experience.map((job) => job.description),
    skills: content.skills.join("\n"),
  };
}

function contentOf({ saved, fields }: MasterCvDraft): MasterCvContent {
  return {
    ...saved,
    headline: fields.headline,
    summary: fields.summary,
    experience: saved.experience.map((job, index) => ({ ...job, description: fields.descriptions[index] ?? job.description })),
    skills: fields.skills
      .split("\n")
      .map((skill) => skill.trim())
      .filter(Boolean),
  };
}
