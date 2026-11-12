import { coachSpaceV2On } from "@/coach-space-v2/server";
import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { publicContactEmail } from "@/public-pages/contact-email";
import { coachingContentReports } from "./index";
import { contentReportEmail } from "./email";
export const getContentReports = () =>
  coachingContentReports(sharedPool(), {
    platformEmail: publicContactEmail,
    send: async (notice) => {
      // « Espace coach v2 » off (ADR-0107): nothing to a Candidate or a Coach; the notice is retried until it is on.
      if (notice.recipient !== "platform" && !coachSpaceV2On()) throw new Error("Espace coach v2 is off");
      await getMailer().send({ to: notice.to, ...contentReportEmail(notice, String(getAuth().options.baseURL)) });
    },
  });
