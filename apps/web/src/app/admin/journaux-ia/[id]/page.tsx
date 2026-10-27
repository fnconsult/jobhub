import { redirect } from "next/navigation";
import { legacyActivityRedirect } from "@/admin/activity";

/** One former Journaux IA log: the same call on Activité › Appels IA since #404. That page checks the Back Office Roles and audits the view. */
export default async function LegacyPage({ params }: { params: Promise<{ id: string }> }) {
  redirect(legacyActivityRedirect("journaux-ia", {}, (await params).id));
}
