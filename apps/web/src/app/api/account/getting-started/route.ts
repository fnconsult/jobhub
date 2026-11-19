import type { GettingStartedResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { getCurrentCandidate } from "@/auth/server";
import { currentGettingStarted } from "@/getting-started/server";

/**
 * « Pour bien commencer » (#1069): the Candidate's account as the help reads it to choose what it presents
 * (`gettingStartedResponseSchema`), for the Jobbbox app; the web reads the same on the server. `account` null once the
 * account's first 14 days are over. 200 · 401
 */
export async function GET() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body: GettingStartedResponse = { account: await currentGettingStarted(candidate) };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
