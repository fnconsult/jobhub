import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { publicContactEmail } from "@/public-pages/contact-email";
import { coachingContentReports } from "./index";
import { contentReportEmail } from "./email";
export const getContentReports = () =>
  coachingContentReports(sharedPool(), {
    platformEmail: publicContactEmail,
    send: async (notice) => {
      await getMailer().send({ to: notice.to, ...contentReportEmail(notice, String(getAuth().options.baseURL)) });
    },
  });
