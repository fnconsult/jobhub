import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { getForwardingSetup } from "@/email-intake/server";

/**
 * How far the Candidate's forwarding setup got (#451), polled by the setup wizard: the Forwarding address in use, Gmail's
 * forwarding confirmation (code and link) if one reached it, and the first email that reached it.
 * 200 { address, activatedAt, confirmation, firstEmail } · 401 · 409 { error: "off" } while Email intake is off
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const setup = await getForwardingSetup(candidate.id);
  return setup ? NextResponse.json(setup, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "off" }, { status: 409 });
}
