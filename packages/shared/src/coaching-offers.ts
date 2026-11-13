import { z } from "zod";
/** Public identity of the party selling a Coaching Offer (ADR-0095). No payment credentials. */
export const coachingSellerSchema = z.object({
  id: z.string(),
  kind: z.enum(["jobbbox", "human_coach", "association"]),
  name: z.string(),
  status: z.string(),
  siret: z.string(),
});
export type CoachingSeller = z.infer<typeof coachingSellerSchema>;
export const JOBBBOX_SELLER: CoachingSeller = { id: "00000000-0000-4000-8000-000000000001", kind: "jobbbox", name: "Jobbbox", status: "", siret: "" };
export interface CoachingSale {
  offerId: string;
  coachId: string;
  seller: CoachingSeller;
  durationMinutes: number;
  amount: number;
  currency: string;
  commissionBps: number;
}
