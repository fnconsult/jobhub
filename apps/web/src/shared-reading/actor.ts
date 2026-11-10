import { getCurrentCandidate } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import { coachSpaceV2On } from "@/coach-space/server";
import type { ReadingActor } from "./index";
export async function readingActor(): Promise<ReadingActor | null> {
  if (!coachSpaceV2On()) return null;
  const person = await getCurrentCandidate();
  if (!person) return null;
  const coach = await getHumanCoaches().coachSignedIn(person);
  return { candidateId: person.id, coachId: coach?.id ?? null };
}
