/** A Coaching Session uses the coach's HTTPS link or telephone (ADR-0097). */
export type Meeting = { kind: "video"; target: string; confirmed: boolean } | { kind: "phone"; target: string; direction: "candidate_calls" | "coach_calls" };
export type MeetingTool = "zoom" | "meet" | "teams" | "video";
export function meetingTool(target: string): MeetingTool {
  try {
    const host = new URL(target).hostname.toLowerCase();
    if (host === "zoom.us" || host.endsWith(".zoom.us")) return "zoom";
    if (host === "meet.google.com") return "meet";
    if (["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].includes(host)) return "teams";
  } catch {
    /* untrusted input */
  }
  return "video";
}
export function parseMeeting(value: unknown): Meeting | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.target !== "string" || input.target.length > 2048) return null;
  if (input.kind === "phone") {
    if (!/^\+?[0-9][0-9 ().-]{5,29}$/.test(input.target) || !["candidate_calls", "coach_calls"].includes(String(input.direction))) return null;
    return { kind: "phone", target: input.target, direction: input.direction as "candidate_calls" | "coach_calls" };
  }
  if (input.kind !== "video") return null;
  try {
    const url = new URL(input.target);
    if (url.protocol !== "https:" || url.username || url.password || (meetingTool(url.href) === "video" && input.confirmed !== true)) return null;
    return { kind: "video", target: url.href, confirmed: input.confirmed === true };
  } catch {
    return null;
  }
}
export function meetingWindow(session: { scheduledAt: Date | null; durationMinutes: number | null }, now: Date): "waiting" | "open" | "ended" {
  if (!session.scheduledAt || +now < +session.scheduledAt - 600_000) return "waiting";
  return +now <= +session.scheduledAt + ((session.durationMinutes ?? 60) + 30) * 60_000 ? "open" : "ended";
}
