import type { AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import { createActionCards } from "../action-cards";
import { createApplications } from "../applications";
import { mailerFromEnv } from "../auth/config";
import { createJobOffers } from "../job-offers";
import { createProfiles } from "../profiles";
import { createFollowUps, type FollowUps } from "./index";

/**
 * Follow-ups wired from environment variables (APP_URL, SMTP_URL, MAIL_FROM;
 * see .env.example), for a process outside the web app such as the worker.
 * Without an AI layer, Follow-ups are drafted from a plain template.
 */
export function followUpsFromEnv(database: Pool, env: Record<string, string | undefined>, ai?: AiLayer): FollowUps {
  const appUrl = env.APP_URL || (env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!appUrl) throw new Error("Missing environment variable APP_URL");
  return createFollowUps(database, {
    actionCards: createActionCards(database),
    applications: createApplications(database, { jobOffers: createJobOffers(database), profiles: createProfiles(database) }),
    mailer: mailerFromEnv(env),
    appUrl,
    ai,
  });
}
