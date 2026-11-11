import { redirect } from "next/navigation";
import { requireCoachSpace } from "@/coach-space/server";
import { routes } from "@/routes";
export default async function Page({ params }: { params: Promise<{ candidateId: string }> }) {
  await requireCoachSpace();
  redirect(routes.coachSpaceCandidate((await params).candidateId));
}
