import { coachSpaceV2On } from "@/coach-space-v2/server";
import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { coachPages } from "./index";
import { normalizeCoachPhoto } from "./photo";
import { coachPageDecisionEmail } from "./email";
export const getCoachPages = () =>
  coachPages(sharedPool(), {
    normalizePhoto: normalizeCoachPhoto,
    // « Espace coach v2 » off (ADR-0106): nothing sent to a Candidate or a Coach; the notice stays pending until it is on.
    ...(coachSpaceV2On()
      ? {
          sendDecision: async (version: Parameters<typeof coachPageDecisionEmail>[0]) => {
            await getMailer().send({ to: version.email, ...coachPageDecisionEmail(version, String(getAuth().options.baseURL)) });
          },
        }
      : {}),
  });
