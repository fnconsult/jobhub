import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { linkedInReadingOn } from "@/coach-actions/on";
import { extensionCallOf } from "@/extension-events/server";
import { getLinkedInReadings } from "@/linkedin-readings/server";

/**
 * Whether the extension may offer « Lire cette page LinkedIn » to the signed-in Candidate (ADR-0119, #1164):
 * LINKEDIN_READING_ENABLED on, never in Production before #1160.
 * 200 { enabled } · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  return NextResponse.json({ enabled: linkedInReadingOn() });
}

/**
 * Keeps what the extension read of a LinkedIn page the Candidate opened, on their click (ADR-0119, #1164): of each person
 * their name, role and company only, filed as contacts of the Application at that employer or the Target Company of that
 * name. Jobbbox's server never reads LinkedIn: it keeps what the extension sent. Only from the extension, for a signed-in
 * Candidate, while LINKEDIN_READING_ENABLED is on.
 * Body: { page: { url }, company, department?, people: [{ name, role?, company? }] }; anything else is left out.
 * 201 { company, peopleRead, peopleKept, filedIn: [{ kind, id, name }] } · 400 · 401 · 403 · 404 (off)
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!(await extensionCallOf(request, candidate?.id ?? null))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!candidate) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (!linkedInReadingOn()) return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body: unknown = await request.json().catch(() => undefined);
  const kept = await getLinkedInReadings().keep(candidate.id, body);
  if (!kept.ok) return NextResponse.json({ error: kept.error }, { status: 400 });
  const { company, peopleRead, people, filedIn } = kept.reading;
  return NextResponse.json(
    { company, peopleRead, peopleKept: people.length, filedIn: filedIn.map(({ kind, id, name }) => ({ kind, id, name })) },
    { status: 201 },
  );
}
