import { redirect } from "next/navigation";
import { legacyRedirect } from "@/platform-settings/parametres";

/** The former Sites de recherche: the Sources tab (Job discovery sites on Recherche web, Job Sites on Extension), in Paramètres since #396 (ADR-0042). Paramètres checks the Back Office Roles. */
export default async function LegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirect("sites", await searchParams));
}
