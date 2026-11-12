import { coachSpaceV2On } from "@/coach-space-v2/server";
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
    // « Espace coach v2 » off (ADR-0106): nothing sent to a Candidate or a Coach; the notice stays pending until it is on.
    ...(coachSpaceV2On()
      ? {
          async sendDecision(record: Parameters<typeof coachEnrolmentDecisionEmail>[0]) {
            await getMailer().send({ to: record.email, ...coachEnrolmentDecisionEmail(record, String(getAuth().options.baseURL)) });
          },
        }
      : {}),
  });
