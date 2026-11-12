import { z } from "zod";
/** A moderated professional profile; no email, drafts, moderation reason or private photo bytes. */
export const publicCoachPageSchema = z.object({
  versionId: z.string(),
  presentation: z.string(),
  specialties: z.array(z.string()),
  languages: z.array(z.string()),
  photoUrl: z.string().nullable(),
});
export type PublicCoachPage = z.infer<typeof publicCoachPageSchema>;
export const coachPhotoUrl = (coachId: string, versionId: string) => `/api/coaching/profiles/${coachId}/${versionId}/photo`;
