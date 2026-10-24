import { NextResponse } from "next/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { CvFileError, CvReadingStopped, draftFromCv, MAX_CV_FILE_BYTES } from "@/cv";
import { actionResponse, STOPPED } from "@/ndjson";
import { getTaskPlaybooks } from "@/task-playbooks/server";

/**
 * Reads an uploaded CV (multipart field "cv": PDF or .docx) into a draft Master
 * CV and Search Criteria for the Candidate to review. Needs no account: a
 * Guest's CV is read the same way for their Match Score. Saves nothing.
 * 200 { masterCv, searchCriteria, provenance? } · 400 { error: CvFileErrorCode } · 403 · 499 { error: "stopped" }
 * · 500 { error: "failed", reason } (its Failure Reason, #367: see actionResponse)
 * `searchCriteria.location` repeats the first of `searchCriteria.locations` for one release
 * (ADR-0025): earlier versions of the browser extension read that one place.
 * `provenance`: what read it, when the AI Coach did (#335); the Profile saved from the draft keeps it.
 *
 * Live (#335), with `Accept: application/x-ndjson`: the reading's step as it starts and ends, then { type: "done", ...draft }
 * · { type: "stopped", error } · { type: "failed", status, error, reason? } (see actionResponse). Aborting the request is the
 * Stop: the reading is aborted and nothing is drafted.
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CV_FILE_BYTES + 64 * 1024) return NextResponse.json({ error: "too_large" }, { status: 400 });

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("cv");
  } catch {
    file = null;
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "unsupported_format" }, { status: 400 });
  const cv = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };

  return actionResponse(request, async ({ signal, onEvent }) => {
    try {
      const draft = await draftFromCv(cv, { ai: getAi, candidateId: candidate?.id ?? null, taskPlaybooks: getTaskPlaybooks(), signal, ...(onEvent ? { onEvent } : {}) });
      return { status: 200, body: { ...draft, searchCriteria: { ...draft.searchCriteria, location: draft.searchCriteria.locations[0] ?? "" } } };
    } catch (error) {
      if (error instanceof CvFileError) return { status: 400, body: { error: error.code } };
      if (error instanceof CvReadingStopped) return { status: STOPPED, body: { error: "stopped" } };
      throw error;
    }
  });
}
