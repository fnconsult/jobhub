import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCandidateSenders } from "@/email-intake/server";

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as unknown;
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** The signed-in Candidate, or the answer refusing the request. */
async function candidateOf(request: Request): Promise<{ id: string } | NextResponse> {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  return candidate ?? NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

const listed = async (candidateId: string) => NextResponse.json(await getCandidateSenders().list(candidateId));

/**
 * The Candidate adds a Recognised sender for themselves alone (#450): « C'est une alerte d'offres ».
 * Body { sender: the sending address or its domain, label? }.
 * 200 { own, platform } · 400 { error: "invalid" | "address_needed" | "already_recognised" | "too_many" } · 401 · 403
 */
export async function POST(request: Request) {
  const candidate = await candidateOf(request);
  if (candidate instanceof NextResponse) return candidate;
  const added = await getCandidateSenders().add(candidate.id, await bodyOf(request));
  if (!added.ok) return NextResponse.json({ error: added.error }, { status: 400 });
  return listed(candidate.id);
}

/**
 * The Candidate switches one of the platform's Recognised senders off, or back on, for themselves alone.
 * Body { value, on: boolean }. 200 { own, platform } · 400 · 401 · 403 · 404
 */
export async function PATCH(request: Request) {
  const candidate = await candidateOf(request);
  if (candidate instanceof NextResponse) return candidate;
  const { value, on } = await bodyOf(request);
  if (typeof value !== "string" || typeof on !== "boolean") return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!(await getCandidateSenders().switchPlatformSender(candidate.id, value, on))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return listed(candidate.id);
}

/** The Candidate removes a sender they added. Body { value }. 200 { own, platform } · 400 · 401 · 403 */
export async function DELETE(request: Request) {
  const candidate = await candidateOf(request);
  if (candidate instanceof NextResponse) return candidate;
  const { value } = await bodyOf(request);
  if (typeof value !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await getCandidateSenders().remove(candidate.id, value);
  return listed(candidate.id);
}
