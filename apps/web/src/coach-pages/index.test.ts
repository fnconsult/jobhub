import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { connectionString, signInWithMagicLink, startTestAuth, type TestAuth } from "../auth/test-support";
import { migrateDatabase } from "../migrations";
import { coachPages, coachPagesOf, deleteCoachPagesOf, migrateCoachPages, type CoachPageVersion } from "./index";
import { normalizeCoachPhoto } from "./photo";
import { coachPageDecisionEmail } from "./email";
const content = { presentation: "Accompagnement professionnel des cadres en transition.", specialties: ["Reconversion"], languages: ["français"] };
describe.skipIf(!connectionString)("moderated Coach Page versions", () => {
  let auth: TestAuth, id: string, ownerId: string, clock: Date, photo: Buffer;
  let pages: ReturnType<typeof coachPages>;
  const send = vi.fn<(version: CoachPageVersion) => Promise<void>>(async () => {});
  beforeEach(async () => {
    auth = await startTestAuth();
    await migrateDatabase(auth.config);
    const cookie = await signInWithMagicLink(auth, "coach-page@example.test");
    ownerId = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    id = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url,bio,public_ready) VALUES('Sophie','coach-page@example.test','','Présentation initiale de candidature.',false) RETURNING id",
      )
    ).rows[0].id;
    photo = await sharp({ create: { width: 24, height: 32, channels: 3, background: { r: 20, g: 50, b: 100 } } })
      .png()
      .toBuffer();
    clock = new Date("2026-11-10T12:00:00Z");
    send.mockReset();
    send.mockResolvedValue(undefined);
    pages = coachPages(auth.database, { now: () => clock, normalizePhoto: normalizeCoachPhoto, sendDecision: send });
  }, 60000);
  afterEach(async () => {
    await auth.stop();
  }, 60000);
  async function submit(basedOn = 0, changes: Partial<typeof content> = {}, action: "keep" | "replace" | "remove" = "keep") {
    return pages.submit(id, { basedOn, content: { ...content, ...changes }, photoAction: action, locale: "fr" }, action === "replace" ? photo : undefined);
  }
  it("never exposes pending text or photo, then publishes the approved snapshot atomically", async () => {
    const saved = await submit(0, {}, "replace");
    expect(saved.ok).toBe(true);
    const versionId = saved.ok ? saved.id : "";
    expect(await pages.approved([id])).toEqual([]);
    expect(await pages.photo(id, versionId)).toBeNull();
    expect((await pages.editor(id))?.latest).toMatchObject({ state: "pending", revision: 1 });
    const first = await pages.decide(versionId, "approve", null);
    expect(first).toMatchObject({ ok: true, changed: true });
    expect(await pages.decide(versionId, "approve", null)).toMatchObject({ ok: true, changed: false });
    const published = (await pages.approved([id]))[0]!.page;
    expect(published).toMatchObject(content);
    expect(published.photoUrl).toContain(versionId);
    expect(JSON.stringify(published)).not.toContain("email");
    expect(await pages.photo(id, versionId)).not.toBeNull();
    expect((await auth.database.query("SELECT bio,public_ready FROM human_coach WHERE id=$1", [id])).rows[0]).toEqual({
      bio: content.presentation,
      public_ready: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(await pages.deliverNotices()).toBe(1);
    expect(await pages.deliverNotices()).toBe(0);
  });
  it("keeps the previous approval public during edits/refusals and emails the mandatory exact refusal reason", async () => {
    const first = await submit(0, {}, "replace");
    await pages.decide(first.ok ? first.id : "", "approve", null);
    const second = await submit(1, { presentation: "Une proposition privée qui ne doit jamais être publiée." });
    const secondId = second.ok ? second.id : "";
    expect((await pages.approved([id]))[0]?.page.presentation).toBe(content.presentation);
    expect(await pages.photo(id, secondId)).toBeNull();
    expect(await pages.decide(secondId, "refuse", " ")).toEqual({ ok: false, error: "invalid" });
    const reason = "Merci de préciser vos qualifications <sans promesse de résultat>.";
    expect(await pages.decide(secondId, "refuse", reason)).toMatchObject({ ok: true, version: { reason } });
    await pages.deliverNotices();
    const refused = send.mock.calls.map(([record]) => record).find((record) => record.id === secondId)!;
    const email = coachPageDecisionEmail(refused, "https://example.test");
    expect(email.text).toContain(reason);
    expect(email.html).not.toContain("<sans promesse de résultat>");
    expect((await pages.approved([id]))[0]?.page.presentation).toBe(content.presentation);
    const third = await submit(2, { presentation: "Nouvelle présentation relue et approuvée par l’équipe." }, "remove");
    await pages.decide(third.ok ? third.id : "", "approve", null);
    expect((await pages.approved([id]))[0]?.page.photoUrl).toBeNull();
    expect(await pages.photo(id, first.ok ? first.id : "")).toBeNull();
  });
  it("serializes edits, refuses stale moderation, and does not reuse an optimistic revision after retention purge", async () => {
    const result = await Promise.all([submit(), submit()]);
    expect(result.filter((r) => r.ok)).toHaveLength(1);
    expect(result.filter((r) => !r.ok && r.error === "conflict")).toHaveLength(1);
    const old = result.find((r) => r.ok)!;
    const next = await submit(1, { presentation: "Deuxième proposition professionnelle à valider." });
    expect(await pages.decide(old.ok ? old.id : "", "approve", null)).toEqual({ ok: false, error: "stale" });
    expect(await pages.decide(next.ok ? next.id : "", "refuse", "À revoir avant publication.")).toMatchObject({ ok: true });
    clock = new Date("2027-06-01T00:00:00Z");
    expect(await pages.purge()).toBe(2);
    expect((await pages.editor(id))?.head).toBe(2);
    expect((await pages.editor(id))?.latest).toBeNull();
    expect(await submit(0)).toEqual({ ok: false, error: "conflict" });
    expect(await submit(2)).toMatchObject({ ok: true, revision: 3 });
  });
  it("copies only an Administrator's legacy biography once, never a new private enrolment or pending edit", async () => {
    await auth.database.query("UPDATE human_coach SET public_ready=true,bio='Biographie saisie par le Back Office.' WHERE id=$1", [id]);
    await migrateCoachPages(auth.database);
    await migrateCoachPages(auth.database);
    expect((await pages.editor(id))?.head).toBe(1);
    expect((await pages.approved([id]))[0]?.page.presentation).toBe("Biographie saisie par le Back Office.");
    await submit(1);
    await migrateCoachPages(auth.database);
    expect(await pages.queue()).toHaveLength(1);
    expect((await pages.approved([id]))[0]?.page.presentation).toBe("Biographie saisie par le Back Office.");
    expect(await pages.deliverNotices()).toBe(0);
  });
  it("binds private exports to the actual submitting account, and ends publication and portraits on account deletion", async () => {
    const saved = await submit(0, {}, "replace");
    await pages.decide(saved.ok ? saved.id : "", "approve", null);
    const mine = await coachPagesOf(auth.database, ownerId);
    expect(mine).toEqual([expect.objectContaining({ photo: { contentType: "image/webp", base64: expect.any(String) } })]);
    await auth.database.query("UPDATE human_coach SET retired_at=clock_timestamp() WHERE id=$1", [id]);
    await auth.database.query("UPDATE candidate SET email='former-owner@example.test' WHERE id=$1", [ownerId]);
    const cookie = await signInWithMagicLink(auth, "coach-page@example.test"),
      newOwner = (await (await auth.request("/api/auth/get-session", { cookie })).json()).user.id;
    expect(await coachPagesOf(auth.database, newOwner)).toEqual([]);
    await deleteCoachPagesOf(auth.database, newOwner);
    expect(await coachPagesOf(auth.database, ownerId)).toHaveLength(1);
    await deleteCoachPagesOf(auth.database, ownerId);
    expect(await coachPagesOf(auth.database, ownerId)).toEqual([]);
    expect(await pages.photo(id, saved.ok ? saved.id : "")).toBeNull();
  });
  it("deletes the verified current Coach's public profile and retires that identity while keeping paid session history", async () => {
    const saved = await submit(0, {}, "replace");
    await pages.decide(saved.ok ? saved.id : "", "approve", null);
    await auth.database.query(
      "INSERT INTO coaching_session(candidate_id,coach_id,stripe_checkout_session_id,amount,currency) VALUES($1,$2,'cs-profile-history',9000,'eur')",
      [ownerId, id],
    );
    await deleteCoachPagesOf(auth.database, ownerId);
    expect(await pages.approved([id])).toEqual([]);
    expect((await auth.database.query("SELECT retired_at,bio FROM human_coach WHERE id=$1", [id])).rows[0]).toMatchObject({
      retired_at: expect.any(Date),
      bio: "",
    });
    expect((await auth.database.query("SELECT id FROM coaching_session WHERE coach_id=$1", [id])).rows).toHaveLength(1);
  });
  it("retries a failed decision recipient without starving another Coach", async () => {
    const first = await submit();
    await pages.decide(first.ok ? first.id : "", "approve", null);
    const cookie = await signInWithMagicLink(auth, "z-later-coach@example.test");
    expect((await auth.request("/api/auth/get-session", { cookie })).ok).toBeTruthy();
    const other = (
      await auth.database.query(
        "INSERT INTO human_coach(name,email,booking_url,public_ready) VALUES('Later','z-later-coach@example.test','',false) RETURNING id",
      )
    ).rows[0].id;
    clock = new Date(+clock + 1000);
    const next = await pages.submit(other, { basedOn: 0, content, photoAction: "keep", locale: "fr" });
    await pages.decide(next.ok ? next.id : "", "approve", null);
    send.mockImplementation(async (version) => {
      if (version.coachId === id) throw new Error("Recipient unavailable");
    });
    expect(await pages.deliverNotices()).toBe(1);
    expect(await pages.deliverNotices()).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid images and fields, closes on retirement, and purges retired portraits", async () => {
    expect(await pages.submit(id, { basedOn: 0, content, photoAction: "replace", locale: "fr" }, Buffer.from("<svg/>"))).toEqual({
      ok: false,
      error: "invalid_photo",
    });
    expect(await submit(0, { presentation: "short" })).toEqual({ ok: false, error: "invalid" });
    const saved = await submit(0, {}, "replace");
    await pages.decide(saved.ok ? saved.id : "", "approve", null);
    await auth.database.query("UPDATE human_coach SET retired_at=$2 WHERE id=$1", [id, clock]);
    expect(await pages.editor(id)).toBeNull();
    expect(await submit(1)).toEqual({ ok: false, error: "not_found" });
    expect(await pages.deliverNotices()).toBe(0);
    clock = new Date("2027-06-01T00:00:00Z");
    expect(await pages.purge()).toBe(1);
  });
});
