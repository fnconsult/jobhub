import { z } from "zod";
import type { CalPort, CalEventType } from "./port";
const eventSchema = z.object({
  id: z.number().int().positive(),
  teamId: z.number().int().positive(),
  lengthInMinutes: z.number().int().positive(),
  bookingUrl: z.string().url(),
  schedulingType: z.enum(["collective", "roundRobin"]),
  hosts: z.array(z.object({ userId: z.number().int().positive() })).length(1),
  disableRescheduling: z.object({ disabled: z.boolean().optional(), minutesBefore: z.number().int().positive().optional() }).optional(),
  assignAllTeamMembers: z.boolean().optional(),
});
export function teamEvent(value: unknown, teamId: number): CalEventType {
  const event = eventSchema.parse(value),
    url = new URL(event.bookingUrl);
  if (
    event.teamId !== teamId ||
    event.assignAllTeamMembers === true ||
    url.origin !== "https://cal.com" ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith("/team/")
  )
    throw new Error("Not a single-host Jobbbox team event");
  return { id: event.id, teamId: event.teamId, hostId: event.hosts[0]!.userId, durationMinutes: event.lengthInMinutes, bookingUrl: url.href,
    ...(!event.disableRescheduling?.disabled && event.disableRescheduling?.minutesBefore
      ? { minimumRescheduleNotice: event.disableRescheduling.minutesBefore }
      : {}),
  };
}
/** Only test harnesses inject a transport. Runtime URLs and API versions are fixed. */
export function calTeam(config: { apiKey: string; fetch?: typeof fetch }): CalPort {
  const call = async (path: string, method = "GET", body?: unknown, version = "2024-06-14") => {
    const response = await (config.fetch ?? fetch)(`https://api.cal.com/v2/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${config.apiKey}`, "cal-api-version": version, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Cal.com ${method} failed (${response.status})`);
    const result: unknown = await response.json();
    return z.object({ status: z.literal("success"), data: z.unknown() }).parse(result).data;
  };
  return {
    async eventType(teamId, id) {
      const event = teamEvent(await call(`teams/${teamId}/event-types/${id}`), teamId);
      if (event.id !== id) throw new Error("Cal.com event identity mismatch");
      return event;
    },
    async createEventType(input) {
      const event = teamEvent(
        await call(`teams/${input.teamId}/event-types`, "POST", {
          title: input.title,
          slug: input.slug,
          lengthInMinutes: input.durationMinutes,
          schedulingType: "collective",
          hosts: [{ userId: input.hostId }],
          hidden: true,
          disableRescheduling: { disabled: false, minutesBefore: 1440 },
          emailSettings: { disableEmailsToAttendees: true, disableEmailsToHosts: true },
        }),
        input.teamId,
      );
      if (event.hostId !== input.hostId || event.durationMinutes !== input.durationMinutes) throw new Error("Cal.com creation context mismatch");
      return event;
    },
    async cancel(uid) {
      if (!/^[\w-]{1,200}$/.test(uid)) throw new Error("Invalid Cal.com booking UID");
      const booking = z
        .object({ uid: z.string(), status: z.string() })
        .parse(await call(`bookings/${encodeURIComponent(uid)}`, "GET", undefined, "2024-08-13"));
      if (booking.uid !== uid) throw new Error("Cal.com cancellation recovery mismatch");
      if (booking.status === "cancelled") return;
      await call(`bookings/${encodeURIComponent(uid)}/cancel`, "POST", { cancellationReason: "Jobbbox: coaching session cancelled" }, "2024-08-13");
    },
  };
}
