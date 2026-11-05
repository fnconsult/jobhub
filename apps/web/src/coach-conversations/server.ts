import { sharedPool } from "@/database/pool";
import { getBilling } from "@/billing/server";
import { getCoach } from "@/coach/server";
import { getCoachProposals } from "@/coach-proposals/server";
import { getProfiles } from "@/profiles/server";
import { getUnansweredQuestions } from "@/unanswered-questions/server";
import { coachCostPerDay, coachCostPerPlaybookAgent, createCoachConversations, type CoachConversations, type CoachCostDay, type PlaybookAgentCost } from "./index";

let instance: CoachConversations | undefined;

/**
 * The app's Coach Conversations, on the database named by DATABASE_URL and the app's AI Coach, within the Coach context limits of
 * each Candidate's Plan (ADR-0078); the questions the help missed go to Unanswered Questions; a reply's Coach proposals become
 * Action Cards under it (#715).
 */
export function getCoachConversations(): CoachConversations {
  instance ??= createCoachConversations(sharedPool(), { coach: getCoach(), profiles: getProfiles(), billing: getBilling(), unansweredQuestions: getUnansweredQuestions(), proposals: getCoachProposals() });
  return instance;
}

/** The AI Coach's cost per day over the last `days` days, newest first (the back office's view). */
export function coachCostOfLastDays(days: number): Promise<CoachCostDay[]> {
  return coachCostPerDay(sharedPool(), new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

/** What each Playbook Agent's consultations cost over the last `days` days, most consulted first (the back office's view). */
export function playbookAgentCostOfLastDays(days: number): Promise<PlaybookAgentCost[]> {
  return coachCostPerPlaybookAgent(sharedPool(), new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}
