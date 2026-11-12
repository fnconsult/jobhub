import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import { requireHumanCoach } from "@/human-coaches/server";
/**
 * Every entry of the new Coach workspace rechecks the active professional identity and required contract acceptance.
 * « Espace coach v2 » off (ADR-0107): a 404, the old Coach space (/espace-coach and /espace-coach/{candidateId}) being
 * served instead by `@/coach-space/legacy`.
 */
export async function requireCoachSpace() {
  requireCoachSpaceV2();
  return requireHumanCoach();
}
