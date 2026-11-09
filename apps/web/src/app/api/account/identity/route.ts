import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getIdentityNames } from "@/candidate-identity/server";

const body = z.object({ givenName: z.string(), familyName: z.string(), preferredName: z.string() });

/**
 * The Candidate saves their Given Name, Family Name and Preferred Name (Mon compte › Identité, #918): all three at once,
 * an empty one cleared; the account's name follows « Prénom Nom ».
 * Body: { givenName, familyName, preferredName }.
 * 200 { givenName, familyName, preferredName } (null each that is empty) · 400 { error: "invalid" } or { error: "too_long", field } · 401 · 403
 */
export async function PUT(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const saved = await getIdentityNames().save(candidate.id, parsed.data);
  if (!saved.ok) return NextResponse.json({ error: "too_long", field: saved.field }, { status: 400 });
  return NextResponse.json(saved.names);
}
