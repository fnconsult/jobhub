import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCandidateData } from "@/candidate-data/server";

/**
 * Deletes the Candidate's account and everything tied to it (ADR-0010); Job
 * Offers are kept. Body: { email }, the Candidate's own email address, typed to confirm.
 * 204 · 400 { error: "confirmation_mismatch" } · 401 · 403
 */
export async function DELETE(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const typed = typeof body === "object" && body !== null && "email" in body && typeof body.email === "string" ? body.email : "";
  if (typed.trim().toLowerCase() !== candidate.email.toLowerCase()) {
    return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
  }

  await getCandidateData().delete(candidate.id);
  return new Response(null, { status: 204 });
}
