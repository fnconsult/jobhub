import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCoachSpace } from "@/coach-space/server";
import { LegacyCoachedCandidatePage, legacyCoachedCandidateMetadata } from "@/coach-space/legacy/LegacyCoachedCandidatePage";
import { coachSpaceV2On } from "@/coach-space-v2/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ candidateId: string }> };

/** « Espace coach v2 » off (ADR-0107): the old Candidate file's title. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return coachSpaceV2On() ? {} : legacyCoachedCandidateMetadata({ params });
}

/** On: the workspace's Candidate file. Off: the old Coach space's read-only Candidate file. */
export default async function Page({ params }: Params) {
  if (!coachSpaceV2On()) return <LegacyCoachedCandidatePage params={params} />;
  await requireCoachSpace();
  redirect(routes.coachSpaceCandidate((await params).candidateId));
}
