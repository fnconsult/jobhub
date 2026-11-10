import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { coachPages } from "./index";
import { normalizeCoachPhoto } from "./photo";
import { coachPageDecisionEmail } from "./email";
export const getCoachPages = () =>
  coachPages(sharedPool(), {
    normalizePhoto: normalizeCoachPhoto,
    sendDecision: async (version) => {
      await getMailer().send({ to: version.email, ...coachPageDecisionEmail(version, String(getAuth().options.baseURL)) });
    },
  });
