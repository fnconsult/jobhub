import { notFound } from "next/navigation";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { coachSpaceV2In } from ".";

/** Whether « Espace coach v2 » is on for this request (ADR-0106). */
export function coachSpaceV2On(): boolean {
  return coachSpaceV2In(getPlatformSettingsResolver().current());
}

/** A page or route of the new Coach workspace or marketplace: a 404 while « Espace coach v2 » is off. */
export function requireCoachSpaceV2(): void {
  if (!coachSpaceV2On()) notFound();
}
