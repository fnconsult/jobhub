import type { AiLayer } from "@jobhub/ai";
import type { Pool } from "pg";
import { createActionCards } from "../action-cards";
import { createApplications } from "../applications";
import { mailerFromEnv } from "../auth/config";
import type { Mailer } from "../auth/index";
import { createJobOffers } from "../job-offers";
import { createProfiles } from "../profiles";
import { taskPlaybooksReader } from "../task-playbooks/worker";
import { createFollowUps, type FollowUps } from "./index";

/**
 * Follow-ups wired from environment variables (APP_URL, BREVO_API_KEY or SMTP_URL, MAIL_FROM;
 * see .env.example), for a process outside the web app such as the worker.
 * Without an AI layer, Follow-ups are drafted from a plain template. `mailer`
 * (default: from env's mail settings) lets the worker pass one kept current with the Provider Secrets.
 */
export function followUpsFromEnv(database: Pool, env: Record<string, string | undefined>, ai?: AiLayer, mailer: Mailer = mailerFromEnv(env)): FollowUps {
  const appUrl = env.APP_URL || (env.NODE_ENV === "production" ? undefined : "http://localhost:3000");
  if (!appUrl) throw new Error("Missing environment variable APP_URL");
  return createFollowUps(database, {
    actionCards: createActionCards(database),
    applications: createApplications(database, { jobOffers: createJobOffers(database), profiles: createProfiles(database) }),
    mailer,
    appUrl,
    ai,
    ...(ai ? { taskPlaybooks: taskPlaybooksReader(database, env) } : {}),
  });
}
