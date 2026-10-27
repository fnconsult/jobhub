import { redirect } from "next/navigation";
import { legacyActivityRedirect } from "@/admin/activity";

/** The former Journaux IA: Activité › Appels IA since #404 (ADR-0042), with its filters. That tab checks the Back Office Roles. */
export default async function LegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyActivityRedirect("journaux-ia", await searchParams));
}
