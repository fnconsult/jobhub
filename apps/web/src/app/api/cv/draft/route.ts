import { NextResponse } from "next/server";
import { getAi } from "@/ai/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { CvFileError, draftFromCv, MAX_CV_FILE_BYTES } from "@/cv";

/**
 * Reads an uploaded CV (multipart field "cv": PDF or .docx) into a draft Master
 * CV and Search Criteria for the Candidate to review. Needs no account: a
 * Guest's CV is read the same way for their Match Score. Saves nothing.
 * 200 { masterCv, searchCriteria } · 400 { error: CvFileErrorCode } · 403
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

  try {
    const draft = await draftFromCv({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { ai: getAi, candidateId: candidate?.id ?? null });
    return NextResponse.json(draft);
  } catch (error) {
    if (error instanceof CvFileError) return NextResponse.json({ error: error.code }, { status: 400 });
    throw error;
  }
}
