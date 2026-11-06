import { getAi } from "@/ai/server";
import { getCoachConversations } from "@/coach-conversations/server";
import { getJobOfferLinks } from "@/job-offer-links/server";
import { getJobOffers } from "@/job-offers/server";
import { servedTaskRun } from "@/task-playbooks";
import { getTaskPlaybooks } from "@/task-playbooks/server";
import { createShareCaptures, type ShareCaptures } from "./index";

let instance: ShareCaptures | undefined;

/**
 * The app's Share captures: links read as the app's Job Offer links are, texts read on the app's AI layer, into the app's
 * Job Offers, opened in its Coach Conversations; the Job Offer Summary and sector only while the "job-offer-reading"
 * task Playbook is served (ADR-0026).
 */
export function getShareCaptures(): ShareCaptures {
  instance ??= createShareCaptures({
    ai: getAi(),
    links: getJobOfferLinks(),
    jobOffers: getJobOffers(),
    conversations: getCoachConversations(),
    reading: async () => (await servedTaskRun(getTaskPlaybooks(), "job-offer-reading", getAi()))?.instructions() ?? null,
  });
  return instance;
}
