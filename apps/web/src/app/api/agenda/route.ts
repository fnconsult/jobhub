import type { AgendaResponse } from "@jobhub/shared/reads";
import { NextResponse } from "next/server";
import { readAgendaMenuAddress } from "@/agenda/menu";
import { getCurrentCandidate } from "@/auth/server";
import { getCandidateReads } from "@/candidate-reads/server";

/**
 * The Agenda as a list (#684): « À planifier » (the signed-in Candidate's Unscheduled Coaching Sessions, with each Human
 * Coach's booking link), then their Agenda Items by day in French time, upcoming; `?periode=passes`, the past ones, as
 * the Agenda's address says. 200 AgendaResponse · 401
 */
export async function GET(request: Request) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { past } = readAgendaMenuAddress({ periode: new URL(request.url).searchParams.get("periode") ?? undefined }, new Date());
  return NextResponse.json<AgendaResponse>(await getCandidateReads().agenda(candidate.id, { past }));
}
