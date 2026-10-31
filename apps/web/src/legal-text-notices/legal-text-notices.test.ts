import type { LegalTextVersion } from "@jobhub/help";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailMessage } from "../auth";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { mailClientLint } from "../emails/mail-client-lint";
import { createLegalTextNotices, legalTextNoticesOf, migrateLegalTextNotices, type LegalTextNoticesDeps } from "./index";

/** Friday 30 October 2026, 10:00 in Paris. */
const TODAY = new Date("2026-10-30T09:00:00.000Z");

const version = (text: LegalTextVersion["text"], effective: string, change: LegalTextVersion["change"], locale: LegalTextVersion["locale"], summary: string): LegalTextVersion => ({
  text,
  locale,
  effective,
  title: text,
  change,
  approvedBy: "Camille Martin",
  summary,
  inBrief: [],
  sections: [{ id: "section-1", number: 1, title: "Objet", body: "…" }],
});

/** Both languages of one version. */
const both = (text: LegalTextVersion["text"], effective: string, change: LegalTextVersion["change"]) => ({
  fr: version(text, effective, change, "fr", `Résumé ${text} ${effective}.`),
  en: version(text, effective, change, "en", `Summary ${text} ${effective}.`),
});

function written(...versions: ReturnType<typeof both>[]): LegalTextNoticesDeps["written"] {
  return { fr: versions.map((entry) => entry.fr), en: versions.map((entry) => entry.en) };
}

describe.skipIf(!connectionString)("Legal Text notices: the email 30 days ahead, the privacy change shown once (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let outbox: MailMessage[];
  let refusing: Set<string>;
  const clock = { now: TODAY };

  async function candidate(id: string, email: string, interfaceLanguage: string, createdAt = "2026-01-15T10:00:00Z", emailVerified = true) {
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ($1, $1, $2, $3, $4, $5, $5)`, [
      id,
      email,
      emailVerified,
      interfaceLanguage,
      createdAt,
    ]);
  }

  const notices = (versions: LegalTextNoticesDeps["written"], options: Partial<LegalTextNoticesDeps> = {}) =>
    createLegalTextNotices(database, {
      mailer: {
        send: async (message) => {
          if (refusing.has(message.to)) throw new Error("Brevo API: HTTP 503");
          outbox.push(message);
        },
      },
      baseURL: "https://app.jobbbox.fr",
      production: true,
      now: () => clock.now,
      written: versions,
      ...options,
    });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateLegalTextNotices(database);
    await migrateLegalTextNotices(database); // safe to run twice
    outbox = [];
    refusing = new Set();
    clock.now = TODAY;
    await candidate("marie", "marie@example.fr", "fr");
    await candidate("john", "john@example.com", "en");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("sendDue — the notice email of a substantial version", () => {
    it("emails each Candidate once of a substantial CGU version at D+31, in their Interface Language, with its date, line and links", async () => {
      const cgu = notices(written(both("cgu", "2026-06-01", "substantielle"), both("cgu", "2026-11-30", "substantielle")));

      expect(await cgu.sendDue()).toEqual({ emails: 2, failed: 0 });
      expect(await cgu.sendDue()).toEqual({ emails: 0, failed: 0 });

      expect(outbox.map((message) => message.to).sort()).toEqual(["john@example.com", "marie@example.fr"]);
      const french = outbox.find((message) => message.to === "marie@example.fr")!;
      expect(french.subject).toBe("Conditions générales d'utilisation : nouvelle version le 30 novembre 2026");
      for (const part of [french.text, french.html]) {
        expect(part).toContain("30 novembre 2026");
        expect(part).toContain("Résumé cgu 2026-11-30.");
        expect(part).toContain("https://app.jobbbox.fr/legal/cgu/2026-11-30?lang=fr");
        expect(part).toContain("https://app.jobbbox.fr/legal/cgu/versions?lang=fr");
        expect(part).toContain("Jobbbox vous demandera d");
      }
      const english = outbox.find((message) => message.to === "john@example.com")!;
      expect(english.subject).toBe("Terms of use: new version on November 30, 2026");
      expect(english.text).toContain("Summary cgu 2026-11-30.");
      expect(english.text).toContain("https://app.jobbbox.fr/legal/cgu/2026-11-30?lang=en");
      expect(english.text).toContain("ask you to accept");
      expect(mailClientLint(french.html!)).toEqual([]);
    });

    it("tracks nothing: no image, no pixel, and every link goes straight to Jobbbox", async () => {
      await notices(written(both("confidentialite", "2026-12-15", "substantielle"))).sendDue();

      for (const message of outbox) {
        expect(message.html).not.toMatch(/<img/i);
        const links = [...message.html!.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) expect(link).toMatch(/^https:\/\/app\.jobbbox\.fr\/legal\//);
      }
      expect(outbox.find((message) => message.to === "marie@example.fr")!.text).toContain("Vous n'avez rien à accepter");
    });

    it("sends nothing for a minor version, a version in effect, nor the legal notice", async () => {
      const sent = await notices(
        written(both("cgu", "2026-12-01", "mineure"), both("cgv", "2026-10-30", "substantielle"), both("mentions-legales", "2026-12-01", "substantielle")),
      ).sendDue();

      expect(sent).toEqual({ emails: 0, failed: 0 });
      expect(outbox).toEqual([]);
    });

    it("sends nothing from the Beta, nor anywhere but Production", async () => {
      expect(await notices(written(both("cgu", "2026-11-30", "substantielle")), { production: false }).sendDue()).toEqual({ emails: 0, failed: 0 });
      expect(outbox).toEqual([]);
    });

    it("picks up where it stopped: an email that failed is sent on the next run, the others never twice", async () => {
      const cgv = notices(written(both("cgv", "2026-12-01", "substantielle")));
      refusing.add("john@example.com");

      expect(await cgv.sendDue()).toEqual({ emails: 1, failed: 1 });
      refusing.clear();
      expect(await cgv.sendDue()).toEqual({ emails: 1, failed: 0 });

      expect(outbox.map((message) => message.to)).toEqual(["marie@example.fr", "john@example.com"]);
    });

    it("emails a Candidate who signed up since, and no address never verified", async () => {
      const cgu = notices(written(both("cgu", "2026-11-30", "substantielle")));
      await cgu.sendDue();
      await candidate("lea", "lea@example.fr", "fr", "2026-10-30T08:00:00Z");
      await candidate("ghost", "ghost@example.fr", "fr", "2026-10-30T08:00:00Z", false);

      expect(await cgu.sendDue()).toEqual({ emails: 1, failed: 0 });
      expect(outbox.at(-1)!.to).toBe("lea@example.fr");
    });
  });

  describe("privacyChange — the substantial change to the privacy policy, shown once", () => {
    const policy = written(both("confidentialite", "2026-06-01", "substantielle"), both("confidentialite", "2026-10-01", "substantielle"), both("confidentialite", "2026-12-15", "substantielle"));

    it("is the latest substantial version in effect, until the Candidate closes it, then never again", async () => {
      const shown = notices(policy);

      expect(await shown.privacyChange("marie")).toEqual({ version: "2026-10-01", url: "/legal/confidentialite/2026-10-01" });
      await shown.dismissPrivacyChange("marie", "2026-10-01");
      expect(await shown.privacyChange("marie")).toBeNull();
      await shown.dismissPrivacyChange("marie", "2026-10-01"); // closing twice changes nothing
      expect(await shown.privacyChange("john")).toEqual({ version: "2026-10-01", url: "/legal/confidentialite/2026-10-01" });
    });

    it("is none before the effective date, for a minor version, or for a Candidate who signed up under it", async () => {
      expect(await notices(written(both("confidentialite", "2026-12-15", "substantielle"))).privacyChange("marie")).toBeNull();
      expect(await notices(written(both("confidentialite", "2026-10-01", "mineure"))).privacyChange("marie")).toBeNull();
      await candidate("lea", "lea@example.fr", "fr", "2026-10-02T08:00:00Z");
      expect(await notices(policy).privacyChange("lea")).toBeNull();
    });

    it("refuses to close a version that is not the one shown", async () => {
      const shown = notices(policy);
      await shown.dismissPrivacyChange("marie", "2026-06-01");
      await shown.dismissPrivacyChange("marie", "../etc");

      expect(await shown.privacyChange("marie")).toEqual({ version: "2026-10-01", url: "/legal/confidentialite/2026-10-01" });
    });
  });

  it("follows the Candidate: in their Data export, and deleted with their account", async () => {
    const both_ = notices(written(both("cgu", "2026-11-30", "substantielle"), both("confidentialite", "2026-10-01", "substantielle")));
    await both_.sendDue();
    await both_.dismissPrivacyChange("marie", "2026-10-01");

    expect(await legalTextNoticesOf(database, "marie")).toEqual({
      emailed: [{ text: "cgu", version: "2026-11-30", sentAt: TODAY }],
      privacyChangesSeen: [{ version: "2026-10-01", seenAt: TODAY }],
    });

    await database.query(`DELETE FROM candidate WHERE id = 'marie'`);
    expect(await legalTextNoticesOf(database, "marie")).toEqual({ emailed: [], privacyChangesSeen: [] });
    expect((await legalTextNoticesOf(database, "john")).emailed).toHaveLength(1);
  });
});
