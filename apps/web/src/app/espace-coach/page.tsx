import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCoachSpace } from "@/coach-space/server";
import { LegacyCoachSpacePage, legacyCoachSpaceMetadata } from "@/coach-space/legacy/LegacyCoachSpacePage";
import { coachSpaceV2On } from "@/coach-space-v2/server";

/** « Espace coach v2 » off (ADR-0107): the old Coach space's title. */
export async function generateMetadata(): Promise<Metadata> {
  return coachSpaceV2On() ? {} : legacyCoachSpaceMetadata();
}

/** On: the workspace opens on « Aujourd'hui ». Off: the old Coach space, its sessions and its Coach Access list. */
export default async function Page() {
  if (!coachSpaceV2On()) return <LegacyCoachSpacePage />;
  await requireCoachSpace();
  redirect("/espace-coach/aujourdhui");
}
