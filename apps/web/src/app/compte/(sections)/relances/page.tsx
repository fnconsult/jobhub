import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { FollowUpDelaysForm } from "@/components/FollowUpDelaysForm";
import { MAX_FOLLOW_UP_DELAY } from "@/follow-ups";
import { getFollowUps } from "@/follow-ups/server";

/** Mon compte's Follow-ups Section: the Follow-up delays. */
export default async function AccountFollowUpsPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  return <FollowUpDelaysForm initial={await getFollowUps().delays(candidate.id)} max={MAX_FOLLOW_UP_DELAY} />;
}
