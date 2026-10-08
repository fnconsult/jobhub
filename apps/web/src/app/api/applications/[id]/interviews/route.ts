import { NextResponse } from "next/server";
import { applicationResponse } from "@/applications/http";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";

/**
 * Adds a dated Interview to an Application at "Entretien".
 * Body: { scheduledAt, note? }: an ISO 8601 date and time; without an offset, it is French time.
 * 200 { id } · 400 { errors } · 401 · 403 · 404 · 409 { error: "not_in_interview" }
 */
export async function POST(request: Request, { params }: RouteContext<"/api/applications/[id]/interviews">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  return applicationResponse(await getApplications().addInterview(candidate.id, (await params).id, body));
}
