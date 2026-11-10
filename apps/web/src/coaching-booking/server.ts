import { bookingChanged } from "./notice";
import { recordingFetch } from "@jobhub/shared";
import { getAuth } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { getSecretResolver } from "@/provider-secrets/server";
import { getPlatformSettingsResolver } from "@/platform-settings/server";
import { getExternalApiLog } from "@/ai-usage/external-api-log";
import { getCoachContracts } from "@/coach-contracts/server";
import { coachSpaceV2On } from "@/coach-space/server";
import { getPushNotifications } from "@/push-notifications/server";
import { coachingBooking } from "./index";
import { calTeam } from "./cal";
import { calLegalReady } from "./legal";
export function calTeamId() {
  return Number(getPlatformSettingsResolver().current().setting("CAL_COM_TEAM_ID")?.value ?? 0);
}
export async function calBookingOn() {
  const env = getSecretResolver().current().env;
  return (
    !!env.CAL_COM_API_KEY &&
    !!env.CAL_COM_WEBHOOK_SECRET &&
    coachSpaceV2On() &&
    calTeamId() > 0 &&
    getPlatformSettingsResolver().current().setting("CAL_COM_REMINDERS_DISABLED")?.value === "true" &&
    (await calLegalReady(sharedPool()))
  );
}
export function getCoachingBooking() {
  const env = getSecretResolver().current().env,
    authSecret = getAuth().options.secret;
  if (typeof authSecret !== "string") throw new Error("Auth secret required");
  const transport = recordingFetch(fetch, getExternalApiLog(), {
    provider: "cal_com",
    operation: (method, url) => `${method} ${url.pathname.includes("/bookings/") ? "booking.cancel" : "team.event_type"}`,
  });
  return coachingBooking(sharedPool(), {
    secret: authSecret,
    webhookSecret: env.CAL_COM_WEBHOOK_SECRET ?? "",
    ...(env.CAL_COM_API_KEY ? { cal: calTeam({ apiKey: env.CAL_COM_API_KEY, fetch: transport }) } : {}),
    permitted: calBookingOn,
    mayBookCoach: async (coachId) => {
      const owner = (
        await sharedPool().query<{ email: string; emailVerified: boolean }>(
          `SELECT c.email,c."emailVerified" FROM human_coach h JOIN candidate c ON lower(c.email)=h.email AND c."emailVerified" WHERE h.id=$1 AND h.retired_at IS NULL`,
          [coachId],
        )
      ).rows[0];
      return !!owner && (await getCoachContracts().mayEnter(owner, coachId));
    },
    changed: (sessionId, eventKey) => bookingChanged(sharedPool(), getPushNotifications(), sessionId, eventKey),
  });
}
