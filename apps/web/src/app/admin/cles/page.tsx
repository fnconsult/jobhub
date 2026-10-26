import { redirect } from "next/navigation";
import { legacyRedirect } from "@/platform-settings/parametres";

/** The former Clés: each key is on the sheet of the provider it is for, in Paramètres since #396 (ADR-0042). Paramètres checks the Back Office Roles. */
export default async function LegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirect("cles", await searchParams));
}
