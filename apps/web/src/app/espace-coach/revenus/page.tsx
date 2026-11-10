import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { requireCoachSpaceV2 } from "@/coach-space/server";
import { ConnectOnboarding } from "@/coaching-connect/ConnectOnboarding";
import { sharedPool } from "@/database/pool";
export default async function Page() {
  const coach = await requireCoachSpaceV2(),
    seller = (await sharedPool().query<{ id: string }>("SELECT id FROM coaching_seller WHERE kind='human_coach' AND coach_id=$1", [coach.id])).rows[0];
  return (
    <CoachSpaceShell>
      <ConnectOnboarding sellerId={seller?.id ?? null} />
    </CoachSpaceShell>
  );
}
