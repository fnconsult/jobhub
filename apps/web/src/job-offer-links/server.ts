import { getAi } from "@/ai/server";
import { getJobOffers } from "@/job-offers/server";
import { servedTaskRun } from "@/task-playbooks";
import { getTaskPlaybooks } from "@/task-playbooks/server";
import { createJobOfferLinks, type JobOfferLinks } from "./index";

let instance: JobOfferLinks | undefined;

/**
 * The app's Job Offer links, read on the app's AI layer into the app's Job Offers, with the Job Offer
 * Summary and sector only while the "job-offer-reading" task Playbook is served (ADR-0026).
 */
export function getJobOfferLinks(): JobOfferLinks {
  instance ??= createJobOfferLinks({
    ai: getAi(),
    jobOffers: getJobOffers(),
    reading: async () => (await servedTaskRun(getTaskPlaybooks(), "job-offer-reading", getAi()))?.instructions() ?? null,
  });
  return instance;
}
