"use client";
import Cal from "@calcom/embed-react";
import { useCalTheme } from "./cal-theme";
import "./cal-embed.css";
const ORIGIN = "https://cal.com",
  NAMESPACE = "jobbbox-availability",
  LAYOUT = "month_view";
/** This preview has no paid-session token: its webhook can never create or date a Jobbbox session. */
export function AvailabilityPreview({ bookingUrl }: { bookingUrl: string }) {
  const theme = useCalTheme(NAMESPACE);
  return (
    <Cal
      calOrigin={ORIGIN}
      calLink={new URL(bookingUrl).pathname.slice(1)}
      namespace={NAMESPACE}
      config={{ layout: LAYOUT, theme }}
      className="cal-embed"
    />
  );
}
