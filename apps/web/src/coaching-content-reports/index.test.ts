import { coachingOffers } from "../coaching-offers";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { connectionString, startTestAuth, signInWithMagicLink, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachingContentReports, type ReportNotice } from "./index";
describe.skipIf(!connectionString)("Public coaching content reports", () => {
  let auth: TestAuth, coach: string, notices: ReportNotice[], reports: ReturnType<typeof coachingContentReports>;
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    coach = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Public Coach','coach@example.test','','Approved professional biography',true) RETURNING id",
      )
    ).rows[0].id;
    notices = [];
    reports = coachingContentReports(auth.database, {
      send: async (notice) => {
        notices.push(notice);
      },
    });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  it("accepts an unauthenticated report and sends its receipt once", async () => {
    const input = {
      requestId: crypto.randomUUID(),
      target: "page",
      coachId: coach,
      reason: "misleading",
      explanation: "The advertised qualification is not accurate.",
      name: "Visitor",
      email: "visitor@example.test",
      goodFaith: true,
      locale: "en",
    };
    const result = await reports.submit(input, null);
    expect(result.ok).toBe(true);
    await reports.submit(input, null);
    await reports.deliverNotices();
    await reports.deliverNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ to: "visitor@example.test", kind: "receipt" });
  });
  it("allows omitted contact only for child abuse and requires good faith", async () => {
    const x = {
      requestId: crypto.randomUUID(),
      target: "page",
      coachId: coach,
      reason: "child_abuse",
      explanation: "This material exploits a child.",
      goodFaith: true,
      locale: "fr",
    };
    expect((await reports.submit(x, null)).ok).toBe(true);
    expect((await reports.submit({ ...x, requestId: crypto.randomUUID(), reason: "other" }, null)).ok).toBe(false);
    expect((await reports.submit({ ...x, requestId: crypto.randomUUID(), goodFaith: false }, null)).ok).toBe(false);
  });
  it("requires a reason, restricts the content, and tells both parties without disclosing the reporter", async () => {
    const sent = await reports.submit(
      {
        requestId: crypto.randomUUID(),
        target: "page",
        coachId: coach,
        reason: "misleading",
        explanation: "The advertised qualification is not accurate.",
        name: "Visitor",
        email: "visitor@example.test",
        goodFaith: true,
        locale: "en",
      },
      null,
    );
    if (!sent.ok) throw Error("not submitted");
    expect(await reports.decide(sent.id, { outcome: "suspend", reason: " ", expectedRevision: 0 }, auth.database)).toBe(null);
    expect(await reports.decide(sent.id, { outcome: "suspend", reason: "Qualification verification required", expectedRevision: 0 }, auth.database)).not.toBe(
      null,
    );
    expect(await reports.blocked(coach, "page")).toBe(true);
    await reports.deliverNotices();
    expect(
      notices
        .filter((n) => n.kind === "decision")
        .map((n) => n.to)
        .sort(),
    ).toEqual(["coach@example.test", "visitor@example.test"]);
    expect(notices.find((n) => n.to === "coach@example.test")).not.toHaveProperty("reporterEmail");
    expect(await reports.decide(sent.id, { outcome: "keep", reason: "Verified evidence received", expectedRevision: 0 }, auth.database)).toBe(null);
    expect(await reports.decide(sent.id, { outcome: "keep", reason: "Verified evidence received", expectedRevision: 1 }, auth.database)).not.toBe(null);
    expect(await reports.blocked(coach, "page")).toBe(false);
  });

  it("enforces offer restriction on a fresh sale and preserves it after reporter erasure", async () => {
    const cookie = await signInWithMagicLink(auth, "visitor@example.test");
    const person = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user;
    const offers = coachingOffers(auth.database, { price: async () => ({ amount: 9000, currency: "eur" }) });
    expect(await offers.sale(person.id, coach)).not.toBe(null);
    const sent = await reports.submit(
      {
        requestId: crypto.randomUUID(),
        target: "offer",
        coachId: coach,
        reason: "other",
        explanation: "Description requires a human investigation.",
        name: "Visitor",
        email: person.email,
        goodFaith: true,
        locale: "en",
      },
      person,
    );
    if (!sent.ok) throw Error("not submitted");
    await reports.decide(sent.id, { outcome: "remove", reason: "Offer violates the published rules", expectedRevision: 0 }, auth.database);
    expect(await offers.sale(person.id, coach)).toBe(null);
    await auth.database.query("DELETE FROM candidate WHERE id=$1", [person.id]);
    expect((await auth.database.query("SELECT * FROM coaching_content_report")).rows).toHaveLength(0);
    expect((await auth.database.query("SELECT recipient FROM coaching_content_report_notice")).rows).toEqual([{ recipient: "platform" }]);
    expect(await reports.blocked(coach, "offer")).toBe(true);
    expect((await reports.list())[0]).toMatchObject({ id: sent.id, explanation: null });
    expect(await reports.decide(sent.id, { outcome: "keep", reason: "Offer corrected and verified", expectedRevision: 1 }, auth.database)).not.toBe(null);
    expect(await offers.sale("any-candidate", coach)).not.toBe(null);
  });
  it("does not repeat a successful recipient when another recipient keeps failing", async () => {
    const sent = await reports.submit(
      {
        requestId: crypto.randomUUID(),
        target: "page",
        coachId: coach,
        reason: "other",
        explanation: "Description requires a human investigation.",
        name: "Visitor",
        email: "visitor@example.test",
        goodFaith: true,
        locale: "en",
      },
      null,
    );
    if (!sent.ok) throw Error();
    await reports.decide(sent.id, { outcome: "keep", reason: "No infringement identified", expectedRevision: 0 }, auth.database);
    let clock = new Date();
    const retry = coachingContentReports(auth.database, {
      now: () => clock,
      send: async (notice) => {
        if (notice.to === "coach@example.test") throw Error("SMTP failure");
        notices.push(notice);
      },
    });
    await retry.deliverNotices();
    clock = new Date(+clock + 300001);
    await retry.deliverNotices();
    expect(notices.filter((n) => n.kind === "decision" && n.to === "visitor@example.test")).toHaveLength(1);
  });
});
