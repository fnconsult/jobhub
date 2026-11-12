import { coachSpaceV2On } from "@/coach-space-v2/server";
import { fiscalJson } from "@/coaching-tax/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getCoachingTaxes } from "@/coaching-tax/server";
export async function PUT(request: Request) {
  if (!coachSpaceV2On()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const person = await getCurrentCandidate();
  if (!person) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const input = await fiscalJson(request);
  const parsed = z.object({ sellerId: z.uuid(), year: z.number().int(), identity: z.unknown() }).strict().safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { sellerId, year, identity } = parsed.data;
  const saved = await getCoachingTaxes().saveIdentity(person.id, sellerId, year, identity);
  return NextResponse.json({ saved }, { status: saved ? 200 : 400 });
}
