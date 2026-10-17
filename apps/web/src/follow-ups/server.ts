import { sharedPool } from "@/database/pool";
import { getAi } from "@/ai/server";
import { getApplications } from "@/applications/server";
import { getMailer } from "@/auth/server";
import { createActionCards } from "@/action-cards";
import { createFollowUps, type FollowUps } from "./index";

let instance: FollowUps | undefined;

/**
 * The app's Follow-ups, on the database named by DATABASE_URL: the Candidate's
 * Follow-up Delays and notices, and what accepting a Follow-up card applies.
 * The worker proposes the Follow-ups (apps/worker).
 */
export function getFollowUps(): FollowUps {
  instance ??= (() => {
    const database = sharedPool();
    return createFollowUps(database, {
      // Proposing only: deciding goes through the app's Action Cards, which call `onAccept`.
      actionCards: createActionCards(database),
      applications: getApplications(),
      mailer: getMailer(),
      appUrl: process.env.APP_URL || "http://localhost:3000",
      ai: getAi(),
    });
  })();
  return instance;
}
