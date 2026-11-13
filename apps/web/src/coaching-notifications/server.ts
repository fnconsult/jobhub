import { sharedPool } from "@/database/pool";
import { getAuth, getMailer } from "@/auth/server";
import { getCoachContracts } from "@/coach-contracts/server";
import { getPushNotifications } from "@/push-notifications/server";
import { coachingNotifications } from "./index";
import { coachingNoticeEmail, coachingNoticePush } from "./messages";
import { coachingNoticesOn } from "./activation-server";
export { coachingNoticesOn } from "./activation-server";
export function getCoachingNotifications() {
  return coachingNotifications(sharedPool(), {
    permitted: async () => coachingNoticesOn(),
    eligibleCoach: (person, id) => getCoachContracts().mayEnter(person, id),
    email: async (person, notice) => {
      await getMailer().send({ to: person.email, ...coachingNoticeEmail(person, notice, String(getAuth().options.baseURL)) });
    },
    push: async (person, notice) => {
      await getPushNotifications().notify(person.id, coachingNoticePush(person, notice), { once: notice.key });
    },
  });
}
