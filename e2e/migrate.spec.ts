import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import pg from "pg";

// Issue #2 / ADR-0004: `npm run db:migrate` lays Candidate accounts out so an
// Organisation layer can later sit above Candidates (a membership table
// pointing at `candidate`) without reshaping Candidate data.
const databaseUrl = new URL(process.env.E2E_DATABASE_URL!);
databaseUrl.pathname = `${databaseUrl.pathname}_migrate`;
const name = databaseUrl.pathname.slice(1);
const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";

async function admin(sql: string) {
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function migrate() {
  return spawnSync("npm", ["run", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    encoding: "utf8",
  });
}

test.describe("Candidate accounts database (npm run db:migrate)", () => {
  test.beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin(`CREATE DATABASE ${name}`);
  });
  test.afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });

  test("creates the Candidate account tables, can be re-run, and keeps every account hanging off `candidate`", async () => {
    const first = migrate();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Candidate accounts are up to date");
    expect(first.stdout).toContain("Profiles are up to date");
    expect(first.stdout).toContain("Job Offers are up to date");
    expect(first.stdout).toContain("Applications are up to date");
    expect(first.stdout).toContain("Company Dossiers are up to date");
    expect(first.stdout).toContain("Cover Letters and Outreach Messages are up to date");
    expect(first.stdout).toContain("Action Cards are up to date");
    expect(first.stdout).toContain("ATS Scores are up to date");
    expect(first.stdout).toContain("Follow-ups are up to date");
    expect(first.stdout).toContain("Plans and Plan Quotas are up to date");
    expect(first.stdout).toContain("Job Searches are up to date");
    expect(first.stdout).toContain("Human Coaches, Coach Access and Coaching Sessions are up to date");
    expect(first.stdout).toContain("Job Digests are up to date");
    expect(first.stdout).toContain("Coach Conversations are up to date");
    expect(first.stdout).toContain("Coach Memory is up to date");
    expect(first.stdout).toContain("Job Sites, Job discovery sources and Job discovery sites are up to date");
    expect(first.stdout).toContain("Back Office Audit is up to date");
    expect(first.stdout).toContain("Back Office Roles are up to date");
    expect(first.stdout).toContain("Sign-in Providers are up to date");
    expect(first.stdout).toContain("Back Office Assistant conversations are up to date");
    expect(first.stdout).toContain("AI Usage is up to date");
    expect(first.stdout).toContain("Coaching Playbooks, the Core Digest, the Sources list and the task Playbooks are up to date");
    expect(first.stdout).toContain("Guardrails are up to date");
    expect(first.stdout).toContain("Eval Cases and Eval Runs are up to date");
    const again = migrate();
    expect(again.status, again.stderr).toBe(0);

    const db = new pg.Client({ connectionString: databaseUrl.toString() });
    await db.connect();
    try {
      const tables = await db.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      // Plus the Agent Run log (issue #31) and the Job Offers (issue #9), which stand apart from Candidate data.
      expect(tables.rows.map((r) => r.table_name)).toEqual([
        "account",
        "action_card",
        "administrator_role", // issue #204: the Back Office Roles each Administrator holds
        "ai_message_log", // issue #218: what each AI call said, kept 30 days
        "ai_tool_usage", // issue #218: the tools each AI call's model used
        "ai_usage", // issue #218: every AI call's tokens and cost, no Candidate
        "application",
        "ats_score", // issue #8: the ATS Score last computed for each Profile
        "back_office_assistant_conversation", // issue #205: an Administrator's Back Office Assistant conversations
        "back_office_assistant_message", // issue #205: their messages
        "back_office_audit", // issue #203: every change made in the Back Office
        "candidate",
        "candidate_plan", // issue #22: Plans and Plan Quotas
        "coach_access", // issue #24: the Human Coaches each Candidate granted Coach Access to
        "coach_conversation", // issue #124: the Candidate's saved Coach Conversations
        "coach_memory_item", // issue #125: the Candidate's Coach Memory
        "coach_message", // issue #124: their messages
        "coach_review", // issue #24: Coach Reviews of Tailored Documents
        "coaching_playbook", // issue #225: the Coaching Playbooks, the Core Digest and the Sources list
        "coaching_session", // issue #24: Coaching Sessions paid through Stripe
        "company_dossier", // issue #17
        "enriched_contact", // issue #23: Enriched Contacts, with their source provider and retrieval date
        "eu_ai_consent", // issue #121: the Candidate's dated EU AI consent
        "eval_case", // issue #231: a Coaching Playbook's Eval Cases, fictional, in each environment
        "eval_run", // issue #231: each Eval Run, with the text of the cases it played
        "extension_job_site", // issue #188: the extension's Job Sites, set in the Back Office
        "external_api_usage", // issue #218: every call to France Travail and contact enrichment, no payload
        "follow_up_delay", // issue #21: each Candidate's Follow-up Delays
        "follow_up_sent", // issue #21: the Follow-ups marked as sent
        "guardrail_message", // issue #228: the Guardrail messages, each version Human-validated apart
        "guardrail_setting", // issue #228: block or flag only, per Guardrail
        "guardrail_trigger", // issue #228: each block, flag or unavailable check, no Candidate, no text
        "human_coach", // issue #24: Human Coaches and their Cal.com booking links
        "interview",
        "job_digest", // issue #15: the Job Digests sent for each Profile
        "job_digest_subscription", // issue #15: opt-in per Profile
        "job_discovery_site", // issue #188: the sites Job discovery searches, set in the Back Office
        "job_discovery_source", // issue #188: the Job discovery sources, each enabled or not
        "job_offer",
        "job_search", // issue #14: on-demand AI Coach job search
        "master_cv_version",
        "plan", // issue #206: the Plans Administrators define
        "plan_quota",
        "playbook_version", // issue #225: every Playbook Version, kept forever
        "profile",
        "provider_secret", // issue #208: Provider Secrets, encrypted
        "quota_usage",
        "session",
        "sign_in_provider", // issue #209: Sign-in Providers configured in the Back Office
        "sign_in_setting", // issue #209: Require SSO for Administrators
        "tailored_cv", // issue #18: Tailored CV proposals and saved Tailored CVs
        "tailored_document", // issue #19: Cover Letters and Outreach Messages
        "verification",
        "workflow_agent_run",
      ]);

      const candidateColumns = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'candidate'",
      );
      const columns = candidateColumns.rows.map((r) => r.column_name as string);
      expect(columns).toEqual(expect.arrayContaining(["id", "email", "interfaceLanguage"]));
      // No tenant column baked into Candidates: Organisations will link to them from above.
      expect(columns.filter((c) => /organi[sz]ation|tenant/i.test(c))).toEqual([]);

      const references = await db.query(`
        SELECT tc.table_name AS from_table, kcu.column_name AS from_column, ccu.table_name AS to_table
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        ORDER BY from_table, from_column, to_table`);
      expect(references.rows).toEqual([
        { from_table: "account", from_column: "userId", to_table: "candidate" },
        { from_table: "action_card", from_column: "candidate_id", to_table: "candidate" },
        // Back Office Roles (issue #204) go with their Administrator's account.
        { from_table: "administrator_role", from_column: "candidate_id", to_table: "candidate" },
        // issue #218: the AI Message Log goes with the Candidate's account and with its AI call; AI Usage names no Candidate.
        { from_table: "ai_message_log", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "ai_message_log", from_column: "usage_id", to_table: "ai_usage" },
        { from_table: "ai_tool_usage", from_column: "usage_id", to_table: "ai_usage" },
        // Applications (issue #12) hang off the Candidate and their Profile; their Job Offers are kept (ADR-0010).
        { from_table: "application", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "application", from_column: "job_offer_id", to_table: "job_offer" },
        { from_table: "application", from_column: "profile_id", to_table: "profile" },
        { from_table: "ats_score", from_column: "profile_id", to_table: "profile" },
        // issue #205: an Administrator's Back Office Assistant conversations, deleted with their account
        { from_table: "back_office_assistant_conversation", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "back_office_assistant_message", from_column: "conversation_id", to_table: "back_office_assistant_conversation" },
        // The Back Office Audit (issue #203) outlives its Administrator: their id is set to null.
        { from_table: "back_office_audit", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "candidate_plan", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "candidate_plan", from_column: "plan", to_table: "plan_quota" },
        // Coach Access, Coach Reviews and Coaching Sessions (issue #24) go with their Candidate (and Application).
        { from_table: "coach_access", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "coach_access", from_column: "coach_id", to_table: "human_coach" },
        // Coach Conversations (issue #124) go with their Candidate, and the Profile they started on; their messages with them.
        { from_table: "coach_conversation", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "coach_conversation", from_column: "profile_id", to_table: "profile" },
        // Coach Memory (issue #125) goes with its Candidate.
        { from_table: "coach_memory_item", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "coach_message", from_column: "conversation_id", to_table: "coach_conversation" },
        // A reply's Job Offer card points to its Job Offer (cleared if the offer is ever deleted).
        { from_table: "coach_message", from_column: "job_offer_id", to_table: "job_offer" },
        { from_table: "coach_review", from_column: "application_id", to_table: "application" },
        { from_table: "coach_review", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "coach_review", from_column: "coach_id", to_table: "human_coach" },
        { from_table: "coaching_session", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "coaching_session", from_column: "coach_id", to_table: "human_coach" },
        // A Company Dossier (issue #17) goes with its Application.
        { from_table: "company_dossier", from_column: "application_id", to_table: "application" },
        // Enriched Contacts (issue #23) go with their Application.
        { from_table: "enriched_contact", from_column: "application_id", to_table: "application" },
        // EU AI consent (issue #121) goes with its Candidate.
        { from_table: "eu_ai_consent", from_column: "candidate_id", to_table: "candidate" },
        // A Coaching Playbook's Eval Cases (issue #231) belong to it; no Candidate in them.
        { from_table: "eval_case", from_column: "playbook_id", to_table: "coaching_playbook" },
        // Follow-up Delays (issue #21) go with their Candidate, Follow-ups sent with their Application.
        { from_table: "follow_up_delay", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "follow_up_sent", from_column: "application_id", to_table: "application" },
        { from_table: "interview", from_column: "application_id", to_table: "application" },
        // Job Digests and their opt-ins (issue #15) go with their Profile (ADR-0010).
        { from_table: "job_digest", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "job_digest", from_column: "profile_id", to_table: "profile" },
        { from_table: "job_digest_subscription", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "job_digest_subscription", from_column: "profile_id", to_table: "profile" },
        // Job Searches (issue #14) hang off the Candidate and the Profile they search for.
        { from_table: "job_search", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "job_search", from_column: "profile_id", to_table: "profile" },
        { from_table: "master_cv_version", from_column: "profile_id", to_table: "profile" },
        // A Plan's quotas belong to a Plan (issue #206), never deleted.
        { from_table: "plan_quota", from_column: "plan", to_table: "plan" },
        // Playbook Versions (issue #225) belong to their Coaching Playbook, neither ever deleted; no Candidate is named.
        { from_table: "playbook_version", from_column: "playbook_id", to_table: "coaching_playbook" },
        { from_table: "profile", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "quota_usage", from_column: "candidate_id", to_table: "candidate" },
        { from_table: "session", from_column: "userId", to_table: "candidate" },
        // A Tailored CV (issue #18) goes with its Application.
        { from_table: "tailored_cv", from_column: "application_id", to_table: "application" },
        { from_table: "tailored_document", from_column: "application_id", to_table: "application" },
      ]);
      // The Plans start with the quotas of issue #22, plus Job Searches (issue #14), counted per week (ADR-0032); re-running keeps them.
      const startingQuotas = [
        { plan: "free", profiles: 1, match_scores: 1, ats_scores: 1, enriched_contacts: 0, job_searches: 1, job_digest: "none" },
        { plan: "standard", profiles: 3, match_scores: null, ats_scores: null, enriched_contacts: 0, job_searches: 7, job_digest: "weekly" },
        { plan: "premium", profiles: null, match_scores: null, ats_scores: null, enriched_contacts: 5, job_searches: null, job_digest: "daily" },
      ];
      const quotas = () =>
        db.query("SELECT plan, profiles, match_scores, ats_scores, enriched_contacts, job_searches, job_digest FROM plan_quota ORDER BY profiles NULLS LAST");
      expect((await quotas()).rows).toEqual(startingQuotas);
      // Plan Quota usage is counted by the week (the Monday it starts on), not by the month.
      const usageColumns = async () =>
        (
          await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quota_usage' ORDER BY column_name")
        ).rows.map((r) => r.column_name as string);
      expect(await usageColumns()).toEqual(["candidate_id", "quota", "used", "week"]);

      // A database from before weekly quotas: its `month` column becomes `week`, and the monthly starting
      // amounts become weekly ones; an amount an Administrator changed is kept as it is.
      await db.query("ALTER TABLE quota_usage RENAME COLUMN week TO month");
      await db.query("UPDATE plan_quota SET match_scores = 3, job_searches = 3 WHERE plan = 'free'");
      await db.query("UPDATE plan_quota SET job_searches = 30 WHERE plan = 'standard'");
      await db.query("UPDATE plan_quota SET enriched_contacts = 12 WHERE plan = 'premium'");
      const upgraded = migrate();
      expect(upgraded.status, upgraded.stderr).toBe(0);
      expect(await usageColumns()).toEqual(["candidate_id", "quota", "used", "week"]);
      expect((await quotas()).rows).toEqual(startingQuotas.map((row) => (row.plan === "premium" ? { ...row, enriched_contacts: 12 } : row)));
    } finally {
      await db.end();
    }
  });
});
