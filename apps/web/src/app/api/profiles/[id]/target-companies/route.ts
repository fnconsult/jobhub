import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { addedTargetCompanyOutcome } from "@/target-companies/http";
import { getTargetCompanies } from "@/target-companies/server";

/**
 * The Candidate adds a company by name to one of their Profiles' Target Companies (#409), as the company register
 * lists it when it does. Body: { name }.
 * 201 { company } · 400 { errors: [{ field: "name", code: "invalid" | "exists" | "not_a_company" }] } · 401 · 403
 */
export async function POST(request: Request, { params }: RouteContext<"/api/profiles/[id]/target-companies">) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: unknown = await request.json().catch(() => undefined);
  const name = typeof body === "object" && body !== null && "name" in body && typeof body.name === "string" ? body.name : "";
  const { status, body: answer } = addedTargetCompanyOutcome(await getTargetCompanies().add(candidate.id, (await params).id, name));
  return NextResponse.json(answer, { status });
}
