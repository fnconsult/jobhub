import { redirect } from "next/navigation";
import { legacyActivityRedirect } from "@/admin/activity";

/** The former Journal: Activité › Actions des administrateurs since #404 (ADR-0042), with its filters. That tab checks the Back Office Roles. */
export default async function LegacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyActivityRedirect("journal", await searchParams));
}
