import { getCurrentCandidate } from "@/auth/server";
import { getHumanCoaches } from "@/human-coaches/server";
import type { ReadingActor } from "./index";
export async function readingActor(): Promise<ReadingActor | null> {
    const person = await getCurrentCandidate();
    if (!person)
        return null;
    const coach = await getHumanCoaches().coachSignedIn(person);
    return { candidateId: person.id, coachId: coach?.id ?? null };
}
