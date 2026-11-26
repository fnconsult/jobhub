import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentKeys, migrateAgentKeys, type AgentKeys } from "@/agent-keys";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "@/auth/test-support";
import { migrateBilling } from "@/billing";
import { createSignalements, migrateSignalements, type Signalements } from "@/signalements";
import { createSignalementTriage, TRIAGE_KEYS } from "@/signalements/triage";

const handled = vi.hoisted(() => ({ keys: null as unknown, triage: null as unknown }));
vi.mock("@/agent-keys/server", () => ({ getAgentKeys: () => handled.keys }));
vi.mock("@/signalements/server", () => ({ getSignalementTriage: () => handled.triage }));

const { GET: queue } = await import("./route");
const { GET: one } = await import("./[id]/route");
const { POST: setStatus } = await import("./[id]/statut/route");

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

  const asKey = (key: string | null = value, init: RequestInit = {}) => ({ ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) } });
  const getQueue = (query = "", key: string | null = value) => queue(new Request(`${WEB}/admin/api/signalements${query}`, asKey(key)));
  const getOne = (id: string, key: string | null = value) => one(new Request(`${WEB}/admin/api/signalements/${id}`, asKey(key)), { params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown, key: string | null = value) =>
    setStatus(new Request(`${WEB}/admin/api/signalements/${id}/statut`, asKey(key, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })), { params: Promise.resolve({ id }) });

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
    handled.triage = createSignalementTriage({
      signalements,
      identityOf: async () => ({ fullName: ["Marie Dupont"], givenName: ["Marie"], lastName: ["Dupont"], email: ["marie.dupont@example.fr"] }),
      environment: "staging",
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
    });
    expect(JSON.stringify(listed)).not.toContain(marie);
    expect((await getOne(before)).status).toBe(404);
    expect(Object.keys((await (await getOne(id)).json()).signalement)).toEqual([...TRIAGE_KEYS]);
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
    expect((await seen.json()).signalement.status).toBe("vu");
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
});
