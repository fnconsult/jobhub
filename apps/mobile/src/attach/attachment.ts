import { cvFileProblem, type CvFileProblem } from "@jobhub/shared";

/** A file the system handed the app (its document picker, a drop on the box): a copy in the app's cache. */
export type GivenFile = { uri: string; name: string; size: number | null; mimeType?: string | null };

/** What is dropped on the box on a tablet, as the native view sends it (modules/drop-target). */
export type DroppedItem = ({ kind: "file" } & GivenFile) | { kind: "text"; text: string };

/**
 * What « + » or a drop gives the conversation (ADR-0076), and so what it does: the link of a Job Offer, sent as the
 * Share capture sends one; a CV, read by `POST /api/cv/draft` as the web's form reads it; a file refused before it is
 * sent (ADR-0068: the server still decides about the rest); or nothing it can take (text without a link).
 */
export type Attachment =
  | { kind: "jobOfferLink"; url: string }
  | { kind: "cv"; file: GivenFile }
  | { kind: "refused"; file: GivenFile; problem: CvFileProblem }
  | { kind: "nothing" };

/** The first web link in `text` (a link copied or dropped alone, or within the words around it), null when none. */
export function linkIn(text: string): string | null {
  const found = /https?:\/\/[^\s<>"'«»]+/i.exec(text)?.[0];
  return found ? found.replace(/[.,;:!?)\]]+$/, "") : null;
}

/** What a file is to the conversation: a CV, unless its format or size refuses it before it is sent. */
export function attachmentOfFile(file: GivenFile): Attachment {
  // A size the system did not say is the server's to judge.
  const problem = cvFileProblem({ name: file.name, size: file.size ?? 0 });
  return problem ? { kind: "refused", file, problem } : { kind: "cv", file };
}

/** What the first item dropped on the box is to the conversation; the others are left. */
export function attachmentOfDrop(items: readonly DroppedItem[]): Attachment {
  const first = items[0];
  if (!first) return { kind: "nothing" };
  if (first.kind === "file") return attachmentOfFile(first);
  const url = linkIn(first.text);
  return url ? { kind: "jobOfferLink", url } : { kind: "nothing" };
}
