import { getDocumentProxy } from "unpdf";
import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { coachEnrolments, coachEnrolmentDecisionEmail } from "./index";
export const getCoachEnrolments = () =>
  coachEnrolments(sharedPool(), {
    async validateProof(bytes) {
      try {
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        return pdf.numPages > 0 && pdf.numPages <= 200;
      } catch {
        return false;
      }
    },
    async confirmEmail(email, id, locale) {
      await getAuth().api.signInMagicLink({
        headers: { origin: String(getAuth().options.baseURL) },
        body: { email, callbackURL: `/devenir-coach/confirmer/${id}`, errorCallbackURL: "/devenir-coach", metadata: { language: locale } },
      });
    },
    async sendDecision(record) {
      await getMailer().send({ to: record.email, ...coachEnrolmentDecisionEmail(record, String(getAuth().options.baseURL)) });
    },
  });
