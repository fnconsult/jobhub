import { NextResponse } from "next/server";
import { getAcceptances } from "@/acceptances/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/**
 * The Candidate accepts a CGU version on the Acceptance screen (ADR-0062, #510). Body: { text: "cgu", version,
 * accepted: true }, the box they ticked; without it, nothing is recorded. Accepting again does nothing.
 * 204 · 400 { error: "not_accepted" } · 401 · 403 · 409 { error: "stale" } (another version is the one to accept now)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body: unknown = await request.json().catch(() => undefined);
  const { text, version, accepted } = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (text !== "cgu" || typeof version !== "string" || accepted !== true) return NextResponse.json({ error: "not_accepted" }, { status: 400 });

  const outcome = await getAcceptances().accept(candidate.id, version);
  return outcome === "accepted" ? new Response(null, { status: 204 }) : NextResponse.json({ error: "stale" }, { status: 409 });
}
