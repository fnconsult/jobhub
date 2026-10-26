import { redirect } from "next/navigation";
import { legacyRedirect } from "@/platform-settings/parametres";

/** The former Connexion: its tab, keeping what a test sign-in came back with (auth/index.ts, TestSignInButton), in Paramètres since #396 (ADR-0042). Paramètres checks the Back Office Roles. */
export default async function LegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyRedirect("connexion", await searchParams));
}
