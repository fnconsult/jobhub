import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { fromJobbboxApp } from "@/api-version";
import { coachSpaceV2On } from "@/coach-space/server";
import { getCoachContracts } from "@/coach-contracts/server";
export async function POST(request: Request) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.accepted !== true || typeof body?.id !== "string") return NextResponse.json({ error: "not_accepted" }, { status: 400 });
  const accepted = await getCoachContracts().accept(person, body.kind, body.id, body.version, body.sha256, fromJobbboxApp(request.headers) ? "mobile" : "web");
  return accepted ? new Response(null, { status: 204 }) : NextResponse.json({ error: "stale" }, { status: 409 });
}
