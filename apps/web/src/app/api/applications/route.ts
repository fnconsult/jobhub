import { NextResponse } from "next/server";
import type { ApplicationsResponse } from "@jobhub/shared/reads";
import { fromExtension } from "@/api-version";
import { applicationListView } from "@/applications/list-view";
import { getApplications } from "@/applications/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * Mes candidatures' card (#684): the signed-in Candidate's Applications, latest saved first, with their status, Match
 * Score, what is à traiter and their next deadline; `?archivees=1` lists the Archived Applications too, as the page does.
 * 200 ApplicationsResponse · 401
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { showArchived } = applicationListView({ archivees: new URL(request.url).searchParams.get("archivees") ?? undefined });
  return NextResponse.json<ApplicationsResponse>(await getCandidateReads().applications(candidate.id, { showArchived }));
}

/**
 * Saves a Job Offer as an Application ("À postuler") with one of the Candidate's Profiles.
 * A Candidate has at most one Application per Job Offer: saving it again answers the one they have.
 * From the extension's Side Panel, a Capture followed: its Offer box entry is made « Suivie », « Extension » (#819).
 * Body: { jobOfferId, profileId }.
 * 201 { id } (created) · 200 { id } (already saved) · 400 { errors } · 401 · 403 · 404
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const saved = await getApplications().save(candidate.id, body, fromExtension(request.headers) ? { from: "extension" } : {});
  if (saved.ok) return NextResponse.json({ id: saved.application.id }, { status: saved.created ? 201 : 200 });
  if ("errors" in saved) return NextResponse.json({ errors: saved.errors }, { status: 400 });
  return NextResponse.json({ error: saved.error }, { status: 404 });
}
