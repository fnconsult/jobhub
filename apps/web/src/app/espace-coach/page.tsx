import { redirect } from "next/navigation";
import { requireCoachSpace } from "@/coach-space/server";
export default async function Page() {
  await requireCoachSpace();
  redirect("/espace-coach/aujourdhui");
}
