import { requireHumanCoach } from "@/human-coaches/server";
/** Every Coach-space entry rechecks the active professional identity and required contract acceptance. */
export async function requireCoachSpace() {
  return requireHumanCoach();
}
