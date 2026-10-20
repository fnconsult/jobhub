import { redirect } from "next/navigation";
import { getCurrentCandidate } from "@/auth/server";
import { FollowUpDelaysForm } from "@/components/FollowUpDelaysForm";
import { MAX_FOLLOW_UP_DELAY } from "@/follow-ups";
import { getFollowUps } from "@/follow-ups/server";
import { routes } from "@/routes";

/** Mon compte's Follow-ups Section: the Follow-up delays. */
export default async function AccountFollowUpsPage() {
  const candidate = await getCurrentCandidate();
  if (!candidate) redirect(routes.signIn);
  return <FollowUpDelaysForm initial={await getFollowUps().delays(candidate.id)} max={MAX_FOLLOW_UP_DELAY} />;
}
