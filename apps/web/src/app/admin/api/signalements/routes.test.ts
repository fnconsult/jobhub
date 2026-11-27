import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentKeys, migrateAgentKeys, type AgentKeys } from "@/agent-keys";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "@/auth/test-support";
import { migrateBilling } from "@/billing";
import { createSignalements, migrateSignalements, type Signalements } from "@/signalements";
import type { GuardrailTrigger } from "@/guardrails";
import { IssuesError, type GitHubIssues } from "@/signalements/github-issues";
import { createSignalementTriage, TRIAGE_KEYS } from "@/signalements/triage";

const handled = vi.hoisted(() => ({ keys: null as unknown, triage: null as unknown }));
vi.mock("@/agent-keys/server", () => ({ getAgentKeys: () => handled.keys }));
vi.mock("@/signalements/server", () => ({ getSignalementTriage: () => handled.triage }));

const { GET: queue } = await import("./route");
const { GET: one } = await import("./[id]/route");
const { POST: setStatus } = await import("./[id]/statut/route");
const { POST: proposeIssue } = await import("./[id]/issue/route");
const { POST: proposeDraft } = await import("./[id]/brouillon/route");

const WEB = "https://app.jobbbox.example";
const FROM = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36", interfaceLanguage: "fr" };

/** Fictitious data only: never a real Signalement's text in a test. */
describe.skipIf(!connectionString)("/admin/api/signalements: Signalement triage through an Agent Key (#1139, ADR-0118; needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let now: Date;
  let keys: AgentKeys;
  let signalements: Signalements;
  let value: string;
  let marie: string;
  let published: { kind: string; number?: number; title?: string; body: string; labels?: readonly string[] }[];
  let triggers: GuardrailTrigger[];
  let githubFailure: IssuesError | null;

  const asKey = (key: string | null = value, init: RequestInit = {}) => ({ ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) } });
  const getQueue = (query = "", key: string | null = value) => queue(new Request(`${WEB}/admin/api/signalements${query}`, asKey(key)));
  const getOne = (id: string, key: string | null = value) => one(new Request(`${WEB}/admin/api/signalements/${id}`, asKey(key)), { params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown, key: string | null = value) =>
    setStatus(new Request(`${WEB}/admin/api/signalements/${id}/statut`, asKey(key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })), { params: Promise.resolve({ id }) });
  const postIssue = (id: string, body: unknown, key: string | null = value) =>
    proposeIssue(new Request(`${WEB}/admin/api/signalements/${id}/issue`, asKey(key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })), { params: Promise.resolve({ id }) });
  const postDraft = (id: string, body: unknown, key: string | null = value) =>
    proposeDraft(new Request(`${WEB}/admin/api/signalements/${id}/brouillon`, asKey(key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })), { params: Promise.resolve({ id }) });

  async function sent(body: Record<string, unknown>): Promise<string> {
    const done = await signalements.send(marie, body, FROM);
    if (!done.ok) throw new Error(`not sent: ${JSON.stringify(done)}`);
    return done.signalement.id;
  }

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.database;
    await migrateBilling(database);
    await migrateSignalements(database);
    await migrateAgentKeys(database);
    now = new Date("2026-11-26T09:00:00Z");
    keys = createAgentKeys(database, { now: () => now });
    signalements = createSignalements(database, { version: "35e2ea1", now: () => now });
    handled.keys = keys;
    published = [];
    triggers = [];
    githubFailure = null;
    const issues: Pick<GitHubIssues, "open" | "comment"> = {
      async open(issue) {
        if (githubFailure) throw githubFailure;
        published.push({ kind: "opened", ...issue });
        return { number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201" };
      },
      async comment(number, body) {
        if (githubFailure) throw githubFailure;
        published.push({ kind: "commented", number, body });
        return { number, url: `https://github.com/fnconsult/jobhub/issues/${number}#issuecomment-1` };
      },
    };
    handled.triage = createSignalementTriage({
      signalements,
      identityOf: async () => ({ fullName: ["Marie Dupont"], givenName: ["Marie"], lastName: ["Dupont"], email: ["marie.dupont@example.fr"] }),
      environment: "staging",
      issues,
      issueUrl: (number) => `https://github.com/fnconsult/jobhub/issues/${number}`,
      triggers: { record: (trigger) => void triggers.push(trigger) },
      now: () => now,
    });
    const created = await keys.create({ name: "triage-beta", scope: "signalements", days: 30 });
    if (!created.ok) throw new Error("key not created");
    value = created.value;
    const cookie = await signInWithMagicLink(testAuth, "marie.dupont@example.fr");
    marie = (await (await testAuth.request("/api/auth/get-session", { cookie })).json()).user.id;
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  it("gives the queue with exactly the keys planned, redacted, the path without ids, only those sent with the AI notice", async () => {
    const before = await sent({ type: "bug", message: "Envoyé avant la mention, ne doit jamais sortir.", path: "/", textSize: "standard" });
    const id = await sent({ type: "bug", message: "Je suis Marie Dupont, marie.dupont@example.fr, rien ne marche.", path: "/candidatures/0b6c2f1e-2222-4222-8222-222222222222", textSize: "large", aiNotice: true });

    const response = await getQueue();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { signalements: listed } = await response.json();

    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0])).toEqual([...TRIAGE_KEYS]);
    expect(listed[0]).toEqual({
      id,
      type: "bug",
      message: "Je suis [NOM], [E-MAIL], rien ne marche.",
      sentAt: "2026-11-26T09:00:00.000Z",
      status: "nouveau",
      environment: "staging",
      version: "35e2ea1",
      device: "Chrome 141, Mac",
      interfaceLanguage: "fr",
      textSize: "large",
      path: "/candidatures/:id",
      attachedQuestion: null,
      attachedCoachReply: null,
      issue: null,
      brouillon: null,
    });
    expect(JSON.stringify(listed)).not.toContain(marie);
    const outOfScope = await getOne(before);
    expect(outOfScope.status).toBe(404);
    expect(await outOfScope.json()).toEqual({ error: "not_found", reason: "no_ai_notice" });
    expect(Object.keys((await (await getOne(id)).json()).signalement)).toEqual([...TRIAGE_KEYS]);
  });

  it("answers a 404 that says why, never anything of the Candidate (#1173): deleted, sent without the AI notice, unknown", async () => {
    const deleted = await sent({ type: "bug", message: "Un bug fictif, supprimé ensuite.", path: "/", textSize: "standard", aiNotice: true });
    await signalements.remove(marie, deleted);
    const unknown = "0b6c2f1e-9999-4999-8999-999999999999";

    for (const answer of [await getOne(deleted), await post(deleted, { statut: "vu" }), await postIssue(deleted, { commentOn: 1188 }), await postDraft(deleted, { fr: "a", en: "b" })]) {
      expect(answer.status).toBe(404);
      expect(await answer.json()).toEqual({ error: "not_found", reason: "deleted" });
    }
    expect(await (await getOne(unknown)).json()).toEqual({ error: "not_found", reason: "unknown" });
    expect(await (await getOne("pas-un-id")).json()).toEqual({ error: "not_found", reason: "unknown" });
  });

  it("keeps one « traité » readable by the key (#1173), « vu » refused on it", async () => {
    const id = await sent({ type: "bug", message: "Un bug fictif pour le test.", path: "/", textSize: "standard", aiNotice: true });
    await signalements.changeStatus(id, "traite");

    const read = await getOne(id);
    expect(read.status).toBe(200);
    expect((await read.json()).signalement).toMatchObject({ id, status: "traite" });
    expect((await getQueue("?statut=traite")).status).toBe(200);
    expect(await (await post(id, { statut: "vu" })).json()).toEqual({ error: "already_handled" });
  });

  it("filters the queue by status, and refuses an unknown one", async () => {
    const seen = await sent({ type: "idee", message: "Une idée fictive pour le test.", path: "/", textSize: "standard", aiNotice: true });
    await sent({ type: "bug", message: "Un bug fictif pour le test.", path: "/", textSize: "standard", aiNotice: true });
    await signalements.changeStatus(seen, "vu");

    expect((await (await getQueue("?statut=vu")).json()).signalements.map((each: { id: string }) => each.id)).toEqual([seen]);
    expect((await (await getQueue("?statut=nouveau,vu")).json()).signalements).toHaveLength(2);
    expect((await getQueue("?statut=ferme")).status).toBe(400);
  });

  it("marks « vu » only, signed key:<name>, which the team reads as « vu par triage-beta »", async () => {
    const id = await sent({ type: "bug", message: "Un bug fictif pour le test.", path: "/", textSize: "standard", aiNotice: true });

    expect((await post(id, { statut: "traite" })).status).toBe(400);
    expect((await post(id, { statut: "nouveau" })).status).toBe(400);
    const seen = await post(id, { statut: "vu" });
    expect(seen.status).toBe(200);
    const answered = await seen.json();
    expect(answered).toEqual({ id, statut: "vu", statutMajPar: "key:triage-beta" });
    expect(Object.keys(answered)).toEqual(["id", "statut", "statutMajPar"]);
    expect(await signalements.one(id)).toMatchObject({ status: "vu", statusChangedBy: "key:triage-beta" });

    await signalements.reply(id, "Merci, c'est corrigé.");
    await signalements.changeStatus(id, "traite");
    expect((await post(id, { statut: "vu" })).status).toBe(409);
    expect((await post("0b6c2f1e-9999-4999-8999-999999999999", { statut: "vu" })).status).toBe(404);
  });

  it("answers 401 without a key, or with a revoked or expired one, read again on each call", async () => {
    expect((await getQueue("", null)).status).toBe(401);
    expect((await getQueue("", "jbx_agent_unknown")).status).toBe(401);
    expect((await getQueue()).status).toBe(200);

    now = new Date("2026-12-26T09:00:00Z");
    expect((await getQueue()).status).toBe(401);

    now = new Date("2026-11-27T09:00:00Z");
    expect((await getQueue()).status).toBe(200);
    await keys.revoke((await keys.list())[0]!.id);
    const revoked = await getQueue();
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toMatch(/^Bearer/);
    expect((await post("0b6c2f1e-9999-4999-8999-999999999999", { statut: "vu" })).status).toBe(401);
  });

  it("never lets an Administrator's session in: only a key opens these routes", async () => {
    const cookie = await signInWithMagicLink(testAuth, "support@jobbbox.ai");

    expect((await queue(new Request(`${WEB}/admin/api/signalements`, { headers: { cookie } }))).status).toBe(401);
  });

  it("logs each call in the key's journal", async () => {
    await getQueue("?statut=nouveau");

    expect(await keys.calls((await keys.list())[0]!.id)).toEqual([{ at: now, method: "GET", path: "/admin/api/signalements?statut=nouveau", outcome: "allowed" }]);
  });

  describe("an issue and a draft reply (#1141)", () => {
    const ISSUE = { title: "Profil : « Valider » sans effet", summary: "Le bouton « Valider » du profil reste sans effet.", steps: "1. Ouvrir /profils/:id.\n2. Cliquer sur « Valider ».", expected: "Le profil est validé.", environment: "Beta", version: "35e2ea1", device: "Chrome 141, Mac" };

    it("publishes the issue once it passes the Guardrail, links it, and the team reads its number", async () => {
      const id = await sent({ type: "bug", message: "Je clique sur valider mon profil et rien ne se passe du tout.", path: "/profils/0b6c2f1e-2222-4222-8222-222222222222", textSize: "standard", aiNotice: true });

      const response = await postIssue(id, ISSUE);

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ issue: { number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201", kind: "opened" } });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ labels: ["needs-triage", "signalement"], body: expect.stringContaining(id) });
      expect((await signalements.one(id))!.issues).toEqual([{ number: 1201, kind: "opened", linkedAt: now, linkedBy: "key:triage-beta" }]);
    });

    it("answers 422 with the reasons, publishes nothing, records the Guardrail Trigger", async () => {
      const id = await sent({ type: "bug", message: "Je clique sur valider mon profil et rien ne se passe du tout.", path: "/", textSize: "standard", aiNotice: true });

      const quoting = await postIssue(id, { ...ISSUE, summary: "« je clique sur valider mon profil et rien ne se passe »" });
      const naming = await postIssue(id, { ...ISSUE, steps: "Se connecter comme Marie Dupont, 06 12 34 56 78." });

      expect(quoting.status).toBe(422);
      expect(await quoting.json()).toEqual({ error: "blocked", guardrail: "candidate_data_in_issue", reasons: ["verbatim_quote"], fields: ["summary"] });
      expect(await naming.json()).toEqual({ error: "blocked", guardrail: "candidate_data_in_issue", reasons: ["identity", "phone"], fields: ["steps"] });
      expect(published).toEqual([]);
      expect(triggers).toHaveLength(2);
      expect((await signalements.one(id))!.issues).toEqual([]);
    });

    it("comments on a duplicate; answers 404 for an issue GitHub does not have, 400 for a text to fix", async () => {
      const id = await sent({ type: "idee", message: "Une idée fictive pour le test.", path: "/", textSize: "standard", aiNotice: true });
      const other = await sent({ type: "idee", message: "Une autre idée fictive pour le test.", path: "/", textSize: "standard", aiNotice: true });

      expect((await postIssue(id, { commentOn: 1188 })).status).toBe(201);
      expect(published[0]).toMatchObject({ kind: "commented", number: 1188, body: expect.stringContaining(id) });
      expect((await postIssue(other, { title: "" })).status).toBe(400);
      githubFailure = new IssuesError("not_found");
      expect(await (await postIssue(other, { commentOn: 99999 })).json()).toEqual({ error: "issue_not_found" });
      expect((await signalements.one(id))!.issues.map((issue) => issue.number)).toEqual([1188]);
      expect((await signalements.one(other))!.issues).toEqual([]);
    });

    it("answers 503 without the token, saying the text passed Redaction and the Guardrail (checked), publishing nothing", async () => {
      const id = await sent({ type: "idee", message: "Une idée fictive pour le test.", path: "/", textSize: "standard", aiNotice: true });
      githubFailure = new IssuesError("missing_token");

      const response = await postIssue(id, ISSUE);

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "github", reason: "missing_token", checked: true });
      expect((await postIssue(id, { ...ISSUE, steps: "Se connecter comme Marie Dupont." })).status).toBe(422);
      expect((await signalements.one(id))!.issues).toEqual([]);
    });

    it("shows what triage did in GET (#1173): the issue and the draft's signature and date; a second issue is refused with 409 already_linked", async () => {
      const id = await sent({ type: "bug", message: "Je clique sur valider mon profil et rien ne se passe du tout.", path: "/", textSize: "standard", aiNotice: true });
      await postIssue(id, ISSUE);
      await postDraft(id, { fr: "Merci, nous corrigeons.", en: "Thank you, we are fixing it." });

      const { signalement } = await (await getOne(id)).json();
      expect(signalement.issue).toEqual({ number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201" });
      expect(signalement.brouillon).toEqual({ proposePar: "key:triage-beta", date: now.toISOString() });
      expect(JSON.stringify(signalement)).not.toMatch(/nous corrigeons|we are fixing/);
      expect((await (await getQueue()).json()).signalements[0]).toEqual(signalement);

      const again = await postIssue(id, ISSUE);
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: "already_linked", issue: { number: 1201, url: "https://github.com/fnconsult/jobhub/issues/1201" } });
      expect((await postIssue(id, { commentOn: 1188 })).status).toBe(409);
      expect(published).toHaveLength(1);
    });

    it("still links an issue to one « traité », so a duplicate's comment outlives Support's reply (#1173)", async () => {
      const id = await sent({ type: "idee", message: "Une idée fictive pour le test.", path: "/", textSize: "standard", aiNotice: true });
      await signalements.changeStatus(id, "traite");

      expect((await postIssue(id, { commentOn: 1188 })).status).toBe(201);
      expect((await postDraft(id, { fr: "a", en: "b" })).status).toBe(409);
      expect((await (await getOne(id)).json()).signalement.issue).toEqual({ number: 1188, url: "https://github.com/fnconsult/jobhub/issues/1188" });
    });

    it("keeps the draft reply, signed by the key; the agent never sets « traité »", async () => {
      const id = await sent({ type: "question", message: "Une question fictive pour le test.", path: "/", textSize: "standard", aiNotice: true, attachedQuestion: "Comment faire ?", attachedCoachReply: "Je ne sais pas." });

      const response = await postDraft(id, { fr: "Voici comment faire.", en: "Here is how." });

      expect(response.status).toBe(201);
      const answered = await response.json();
      expect(answered).toEqual({ id, brouillon: { proposePar: "key:triage-beta", date: now.toISOString() } });
      expect(Object.keys(answered)).toEqual(["id", "brouillon"]);
      expect(Object.keys(answered.brouillon)).toEqual(["proposePar", "date"]);
      expect(await signalements.one(id)).toMatchObject({ status: "nouveau", reply: null, draft: { proposedBy: "key:triage-beta" } });
      expect((await postDraft(id, { fr: "Seulement en français." })).status).toBe(400);
      expect((await postDraft("0b6c2f1e-9999-4999-8999-999999999999", { fr: "a", en: "b" })).status).toBe(404);
    });

    it("refuses both without a key: an Agent Key only", async () => {
      expect((await postIssue("0b6c2f1e-9999-4999-8999-999999999999", ISSUE, null)).status).toBe(401);
      expect((await postDraft("0b6c2f1e-9999-4999-8999-999999999999", { fr: "a", en: "b" }, null)).status).toBe(401);
    });
  });
});
