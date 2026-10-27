import { notFound, redirect } from "next/navigation";
import { activityTabs } from "@/admin/activity";
import { requireBackOffice } from "@/admin/server";

/** Activité (#404): its first tab the Administrator reads; whoever reads one of its tabs reads its Recherches. */
export default async function ActivityPage() {
  const { access } = await requireBackOffice("discoveryRuns");
  const [first] = activityTabs(access);
  if (!first) notFound();
  redirect(first.href);
}
