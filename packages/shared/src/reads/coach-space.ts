/** Whether the signed-in person is an active Human Coach (ADR-0016), so the Jobbbox app offers « Espace coach » (#689). */
import * as z from "zod";

/** `GET /api/coach-space`: true for a Human Coach not retired, signed in with their verified email, including pending contract acceptance. Navigation only; not an access grant. */
export const coachSpaceResponseSchema = z.object({
  humanCoach: z.boolean(),
  associationSpace: z.boolean().optional(),
  /**
   * « Espace coach v2 » (ADR-0106): true only while the Platform Setting is on. Absent (off, or a server from before
   * it) reads as off: the app then behaves as before the Human Coach epic.
   */
  coachSpaceV2: z.boolean().optional(),
});
export type CoachSpaceResponse = z.infer<typeof coachSpaceResponseSchema>;
