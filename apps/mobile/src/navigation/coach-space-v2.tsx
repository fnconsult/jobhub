import { Unmatched } from "expo-router";
import type { ComponentType } from "react";
import { useCoachSpaceV2Known } from "./human-coach";

/**
 * A screen only the Human Coach epic has (« Espace coach v2 », ADR-0106): while it is off, its address is unknown to the
 * app, as before the epic (Expo Router's « not found »); nothing while the server has not said yet.
 */
export function coachSpaceV2Only<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  function CoachSpaceV2Screen(props: P) {
    const on = useCoachSpaceV2Known();
    if (on === undefined) return null;
    return on ? <Screen {...props} /> : <Unmatched />;
  }
  return CoachSpaceV2Screen;
}
