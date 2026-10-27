import { NextResponse } from "next/server";
import { getCurrentCandidate, isFromTrustedOrigin } from "@/auth/server";
import { getEmailIntake } from "@/email-intake/server";

/**
 * The Candidate replaces their Forwarding address with a new one: the old one stops at once.
 * 200 { address, activatedAt } · 401 · 403 · 409 { error: "off" } while Email intake is off
 */
export async function POST(request: Request) {
  if (!isFromTrustedOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const replaced = await getEmailIntake().replace(candidate.id);
  return replaced ? NextResponse.json(replaced) : NextResponse.json({ error: "off" }, { status: 409 });
}
