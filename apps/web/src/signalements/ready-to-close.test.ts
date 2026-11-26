import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateBilling } from "../billing";
import { IssuesError, type GitHubIssues } from "./github-issues";
import { createSignalements, migrateSignalements, signalementsOf, type Signalements } from "./index";
import { createReadyToClose } from "./ready-to-close";

const FROM = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", interfaceLanguage: "fr" };

/**
 * GitHub as the deploy check reads it: which commit closed each issue, and which commits each deployed one carries.
 * `calls` counts the issues read.
 */
function fakeGitHub(closedBy: Record<number, string | null>, deployed: Record<string, string[]>) {
  const calls: number[] = [];
  let failure: IssuesError | null = null;
  const github: Pick<GitHubIssues, "closingCommit" | "contains"> = {
    async closingCommit(number) {
      if (failure) throw failure;
      calls.push(number);
      return closedBy[number] ?? null;
    },
    async contains(commit, fix) {
      return commit === fix || (deployed[commit] ?? []).includes(fix);
    },
  };
  return { github, calls, fail: (error: IssuesError | null) => void (failure = error) };
}

/** Fictitious data only: never a real Signalement's text in a test. */
describe.skipIf(!connectionString)("« Prêt à clore » at each deploy (#1141, ADR-0118; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let signalements: Signalements;
  let marie: string;
  let jean: string;

  async function candidate(email: string): Promise<string> {
    const cookie = await signInWithMagicLink(testAuth, email);
    return (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }

  async function linked(who: string, issue: number, kind: "opened" | "commented" = "opened"): Promise<string> {
    const sent = await signalements.send(who, { type: "bug", message: "Un bug fictif pour le test.", path: "/", textSize: "standard", aiNotice: true }, FROM);
    if (!sent.ok) throw new Error("fixture Signalement refused");
    await signalements.linkIssue(sent.signalement.id, { number: issue, kind }, "key:triage-beta");
    return sent.signalement.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBilling(database);
    await migrateSignalements(database);
    signalements = createSignalements(database, { version: "35e2ea1", now: () => new Date("2026-11-26T09:00:00Z") });
    marie = await candidate("marie.dupont@example.fr");
    jean = await candidate("jean.martin@example.fr");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("marks « Prêt à clore » a Signalement of the Beta once a deploy to the Beta carries the commit that closed its issue", async () => {
    const id = await linked(marie, 1201);
    const { github } = fakeGitHub({ 1201: "fix1201" }, { deploy2: ["fix1201"] });
    const readyToClose = createReadyToClose({ signalements, github, environment: "staging" });

    expect(await readyToClose.afterDeploy({ environment: "staging", commit: "deploy1" })).toEqual({ checked: 1, ready: [], failed: 0 });
    expect((await signalements.one(id))!.readyToCloseAt).toBeNull();

    expect(await readyToClose.afterDeploy({ environment: "staging", commit: "deploy2" })).toEqual({ checked: 1, ready: [id], failed: 0 });
    expect((await signalements.one(id))!.readyToCloseAt).not.toBeNull();
    // The team's alone: the Candidate's own reading is unchanged.
    expect((await signalementsOf(database, marie))[0]!.status).toBe("nouveau");
  });

  it("leaves a Signalement of Production as it is after a deploy to the Beta; the Promoted Version's deploy marks it", async () => {
    const id = await linked(marie, 1201);
    const { github, calls } = fakeGitHub({ 1201: "fix1201" }, { beta: ["fix1201"], promoted: ["fix1201"] });
    const production = createReadyToClose({ signalements, github, environment: "production" });

    expect(await production.afterDeploy({ environment: "staging", commit: "beta" })).toEqual({ skipped: "other_environment" });
    expect((await signalements.one(id))!.readyToCloseAt).toBeNull();
    expect(calls).toEqual([]);

    expect(await production.afterDeploy({ environment: "production", commit: "promoted" })).toEqual({ checked: 1, ready: [id], failed: 0 });
  });

  it("marks together every Signalement linked to the same issue", async () => {
    const first = await linked(marie, 1201, "opened");
    const second = await linked(jean, 1201, "commented");
    const other = await linked(jean, 1300);
    const { github } = fakeGitHub({ 1201: "fix1201", 1300: null }, { deploy: ["fix1201"] });

    const done = await createReadyToClose({ signalements, github, environment: "staging" }).afterDeploy({ environment: "staging", commit: "deploy" });

    expect(done).toMatchObject({ checked: 2, failed: 0 });
    expect("ready" in done && [...done.ready].sort()).toEqual([first, second].sort());
    expect((await signalements.one(other))!.readyToCloseAt).toBeNull();
  });

  it("reads each issue once per deployed commit, and again when GitHub could not answer", async () => {
    await linked(marie, 1201);
    const { github, calls, fail } = fakeGitHub({ 1201: null }, {});
    const readyToClose = createReadyToClose({ signalements, github, environment: "staging" });

    fail(new IssuesError("failed"));
    expect(await readyToClose.afterDeploy({ environment: "staging", commit: "deploy" })).toEqual({ checked: 0, ready: [], failed: 1 });
    fail(null);
    await readyToClose.afterDeploy({ environment: "staging", commit: "deploy" });
    await readyToClose.afterDeploy({ environment: "staging", commit: "deploy" });
    expect(calls).toEqual([1201]);
  });

  it("does nothing without a deployed commit, or without GitHub's read-only token", async () => {
    await linked(marie, 1201);
    const { github, fail } = fakeGitHub({ 1201: "fix" }, {});
    const readyToClose = createReadyToClose({ signalements, github, environment: "staging" });

    expect(await readyToClose.afterDeploy({ environment: "staging", commit: null })).toEqual({ skipped: "no_commit" });
    fail(new IssuesError("missing_token"));
    expect(await readyToClose.afterDeploy({ environment: "staging", commit: "deploy" })).toEqual({ skipped: "missing_token" });
  });
});
