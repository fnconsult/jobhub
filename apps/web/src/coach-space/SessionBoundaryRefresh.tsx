"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Keep server-authorized phase, report and reading gates current without navigating or losing local form state. */
export function SessionBoundaryRefresh({ scheduledAt, durationMinutes }: { scheduledAt: string | null; durationMinutes: number | null }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const boundaries = scheduledAt
      ? [
          Date.parse(scheduledAt) - 600_000,
          Date.parse(scheduledAt) + (durationMinutes ?? 60) * 60_000,
          Date.parse(scheduledAt) + ((durationMinutes ?? 60) + 30) * 60_000 + 1,
        ]
      : [];
    function schedule() {
      clearTimeout(timer);
      const next = boundaries.filter((at) => at > Date.now()).sort((a, b) => a - b)[0];
      // Also discover a reschedule made in another participant's browser.
      timer = setTimeout(
        () => {
          router.refresh();
          schedule();
        },
        Math.min(60_000, next === undefined ? 60_000 : Math.max(25, next - Date.now() + 25)),
      );
    }
    function visible() {
      if (document.visibilityState === "visible") {
        router.refresh();
        schedule();
      }
    }
    if (boundaries.some((at) => at <= Date.now() && at > Date.now() - 5000)) router.refresh();
    schedule();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [scheduledAt, durationMinutes, router]);
  return null;
}
