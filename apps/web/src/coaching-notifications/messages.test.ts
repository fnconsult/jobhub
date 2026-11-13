import { it, expect } from "vitest";
import { coachingNoticeEmail, coachingNoticePush } from "./messages";
import type { NoticeRecipient, CoachingNotice } from "./index";
const person: NoticeRecipient = { id: "owner", email: "owner@example.test", locale: "fr", timeZone: "America/Montreal", audience: "candidate" };
const notice: CoachingNotice = {
  key: "e".repeat(64),
  kind: "hour_before",
  sessionId: "11111111-1111-1111-1111-111111111111",
  scheduledAt: new Date("2026-11-01T06:30Z"),
};
it("joins through the owned private page and shows the local and Paris clocks, without exposing a meeting secret", () => {
  const email = coachingNoticeEmail(person, notice, "https://example.test");
  expect(email.text).toContain("https://example.test/coachs/seances/11111111-1111-1111-1111-111111111111");
  expect(email.text).toContain("America/Montreal");
  expect(email.text).toContain("Europe/Paris");
  expect(email.text).toContain("dix minutes");
  const push = coachingNoticePush(person, notice);
  expect(push).toEqual({ event: "coaching_session_hour", sessionId: notice.sessionId, noticeKey: notice.key });
  expect(JSON.stringify(push)).not.toContain("2026-11-01");
  expect(JSON.stringify(push)).not.toContain("owner@example.test");
});
it("uses the Coach’s workspace for a cancellation rather than an unavailable closed-session page", () => {
  expect(coachingNoticeEmail({ ...person, audience: "coach" }, { ...notice, kind: "cancelled" }, "https://example.test").text).toContain(
    "https://example.test/espace-coach/aujourdhui",
  );
});
