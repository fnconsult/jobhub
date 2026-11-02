import type { ReleaseNote } from "@jobhub/help";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MailMessage } from "../auth";
import { connectionString, startTestAuth, type TestAuth } from "../auth/test-support";
import { mailClientLint } from "../emails/mail-client-lint";
import { nouveautesEmail, plainText } from "./email";
import { unsubscribeResponse } from "./http";
import { announcedNotes, createNouveautesEmails, migrateNouveautesEmails, nouveautesEmailOf, type NouveautesEmailsDeps } from "./index";

const APP = "https://app.jobbbox.fr";
/** Monday 2 November 2026, 10:37 in Paris. */
const MONDAY = new Date("2026-11-02T09:37:00.000Z");
const DAY = 86_400_000;

const note = (version: string, locale: ReleaseNote["locale"], { announce = true, date = "2026-11-02" }: { announce?: boolean; date?: string } = {}): ReleaseNote => ({
  version,
  locale,
  date,
  title: locale === "fr" ? `Titre ${version}` : `Title ${version}`,
  tags: ["candidature"],
  image: { file: `${version}.png`, alt: "Capture" },
  announce,
  intro: locale === "fr" ? `Intro **${version}**, voir [l'aide](https://app.jobbbox.fr/aide).` : `Intro **${version}**.`,
  changes: [
    { kind: "new", text: locale === "fr" ? `**Nouveau ${version}** : une ligne.` : `**New ${version}**: a line.` },
    { kind: "fixed", text: `Corrigé ${version}` },
  ],
});

/** Both languages of each note. */
function written(...versions: [string, { announce?: boolean; date?: string }?][]): NouveautesEmailsDeps["written"] {
  return { fr: versions.map(([version, options]) => note(version, "fr", options)), en: versions.map(([version, options]) => note(version, "en", options)) };
}

describe("announcedNotes — the Release Notes a Production serving a Version announces", () => {
  it("are the announced ones up to the Version served, oldest first; none without a Version", () => {
    const notes = written(["0.1.0", { announce: false }], ["0.2.0"], ["0.3.0"], ["0.4.0"])!.fr;
    expect(announcedNotes(notes, "0.3.0").map((entry) => entry.version)).toEqual(["0.2.0", "0.3.0"]);
    expect(announcedNotes(notes, null)).toEqual([]);
  });
});

describe("nouveautesEmail — the email of an announced Release Note", () => {
  const render = (language: "fr" | "en") =>
    nouveautesEmail({ note: note("0.2.0", language), noteUrl: `${APP}/nouveautes/0.2.0?lang=${language}`, unsubscribeUrl: `${APP}/desabonnement/nouveautes?token=t0k3n&lang=${language}` }, language);

  it("says the title, the introduction and the « Nouveau » lines, with the link to the Version on Nouveautés and to unsubscribe", () => {
    const email = render("fr");
    expect(email.subject).toBe("Nouveauté Jobbbox : Titre 0.2.0");
    expect(email.html).toContain("Titre 0.2.0"); // the text part has it in its subject
    for (const part of [email.text, email.html]) {
      expect(part).toContain("Intro 0.2.0, voir l");
      expect(part).toContain("Nouveau 0.2.0 : une ligne.");
      expect(part).not.toContain("Corrigé 0.2.0");
      expect(part).not.toContain("**");
      expect(part).toContain(`${APP}/nouveautes/0.2.0?lang=fr`);
      expect(part).toContain("/desabonnement/nouveautes?token=t0k3n&");
    }
    expect(render("en").subject).toBe("New in Jobbbox: Title 0.2.0");
    expect(mailClientLint(email.html)).toEqual([]);
  });

  it("tracks nothing: no image, no pixel, and every link goes straight to Jobbbox", () => {
    for (const language of ["fr", "en"] as const) {
      const { html } = render(language);
      expect(html).not.toMatch(/<img|background=|url\(/i);
      const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toMatch(/^https:\/\/app\.jobbbox\.fr\/(nouveautes|desabonnement)\//);
    }
  });

  it("drops the Markdown's marks, links included", () => {
    expect(plainText("**Gras** et *italique*, `code` et [un lien](https://example.com).")).toBe("Gras et italique, code et un lien.");
  });
});

describe("unsubscribeResponse — the email's unsubscribe link, with no sign-in", () => {
  const known = { unsubscribeByToken: async (token: string) => token === "good" };
  it("answers the one-click POST with 200 or 404, and the page's button with a redirect saying whether it worked", async () => {
    const oneClick = (token: string) => new Request(`${APP}/api/nouveautes-email/unsubscribe?token=${token}`, { method: "POST", body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }) });
    expect((await unsubscribeResponse(oneClick("good"), known)).status).toBe(200);
    expect((await unsubscribeResponse(oneClick("bad"), known)).status).toBe(404);
    const button = await unsubscribeResponse(new Request(`${APP}/api/nouveautes-email/unsubscribe?token=good&lang=en`, { method: "POST" }), known);
    expect(button.status).toBe(303);
    expect(button.headers.get("location")).toBe(`${APP}/desabonnement/nouveautes?done=1&lang=en`);
  });
});

describe.skipIf(!connectionString)("Nouveautés email: the box in Mon compte, one email a week per announced note (needs Postgres: DATABASE_URL)", () => {
  let testAuth: TestAuth;
  let database: Pool;
  let outbox: MailMessage[];
  let refusing: Set<string>;
  const clock = { now: MONDAY };

  async function candidate(id: string, email: string, interfaceLanguage: string, emailVerified = true) {
    await database.query(`INSERT INTO candidate (id, name, email, "emailVerified", "interfaceLanguage", "createdAt", "updatedAt") VALUES ($1, $1, $2, $3, $4, $5, $5)`, [
      id,
      email,
      emailVerified,
      interfaceLanguage,
      "2026-01-15T10:00:00Z",
    ]);
  }

  const emails = (notes: NouveautesEmailsDeps["written"], options: Partial<NouveautesEmailsDeps> = {}) =>
    createNouveautesEmails(database, {
      mailer: {
        send: async (message) => {
          if (refusing.has(message.to)) throw new Error("Brevo API: HTTP 503");
          outbox.push(message);
        },
      },
      baseURL: APP,
      production: true,
      version: "0.3.0",
      now: () => clock.now,
      written: notes,
      ...options,
    });

  beforeEach(async () => {
    testAuth = await startTestAuth();
    database = testAuth.auth.options.database as Pool;
    await migrateNouveautesEmails(database);
    await migrateNouveautesEmails(database); // safe to run twice
    outbox = [];
    refusing = new Set();
    clock.now = MONDAY;
    await candidate("marie", "marie@example.fr", "fr");
    await candidate("john", "john@example.com", "en");
  }, 60_000);
  afterEach(async () => {
    await testAuth.stop();
  }, 60_000);

  describe("the box in Mon compte", () => {
    it("is unticked for every Candidate until they tick it; ticking keeps the date, unticking deletes it", async () => {
      const module = emails(written());
      expect(await module.setting("marie")).toEqual({ subscribed: false, subscribedAt: null });

      expect(await module.subscribe("marie")).toEqual({ subscribed: true, subscribedAt: MONDAY });
      clock.now = new Date(MONDAY.getTime() + DAY);
      expect((await module.subscribe("marie")).subscribedAt).toEqual(MONDAY); // ticked again: the first consent stays
      expect(await module.setting("john")).toEqual({ subscribed: false, subscribedAt: null });

      expect(await module.unsubscribe("marie")).toEqual({ subscribed: false, subscribedAt: null });
    });

    it("is in the Data export with its date and the emails sent, never the unsubscribe token", async () => {
      const module = emails(written(["0.3.0"]));
      expect(await nouveautesEmailOf(database, "marie")).toEqual({ subscribed: false, subscribedAt: null, sent: [] });
      await module.subscribe("marie");
      await module.sendDue();
      const exported = await nouveautesEmailOf(database, "marie");
      expect(exported).toEqual({ subscribed: true, subscribedAt: MONDAY, sent: [{ version: "0.3.0", sentAt: MONDAY }] });
      expect(JSON.stringify(exported)).not.toMatch(/token/i);
    });
  });

  describe("sendDue — one email per Candidate and per announced note, at most one a week", () => {
    it("emails each subscribed Candidate once, in their Interface Language, and no one who did not tick the box", async () => {
      await candidate("paul", "paul@example.fr", "fr");
      const module = emails(written(["0.3.0"]));
      await module.subscribe("marie");
      await module.subscribe("john");

      expect(await module.sendDue()).toEqual({ emails: 2, failed: 0 });
      expect(await module.sendDue()).toEqual({ emails: 0, failed: 0 });
      clock.now = new Date(MONDAY.getTime() + 30 * DAY);
      expect(await module.sendDue()).toEqual({ emails: 0, failed: 0 });

      expect(outbox.map((message) => message.to).sort()).toEqual(["john@example.com", "marie@example.fr"]);
      const french = outbox.find((message) => message.to === "marie@example.fr")!;
      expect(french.subject).toBe("Nouveauté Jobbbox : Titre 0.3.0");
      expect(french.text).toContain(`${APP}/nouveautes/0.3.0?lang=fr`);
      expect(french.headers?.["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.jobbbox\.fr\/api\/nouveautes-email\/unsubscribe\?token=[A-Za-z0-9_-]{43}>$/);
      expect(french.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(outbox.find((message) => message.to === "john@example.com")!.subject).toBe("New in Jobbbox: Title 0.3.0");
    });

    it("sends one email for two notes of the same week: the second goes a week after the first", async () => {
      const module = emails(written(["0.2.0"], ["0.3.0"]));
      await module.subscribe("marie");

      expect(await module.sendDue()).toEqual({ emails: 1, failed: 0 });
      clock.now = new Date(MONDAY.getTime() + 6 * DAY);
      expect(await module.sendDue()).toEqual({ emails: 0, failed: 0 });
      clock.now = new Date(MONDAY.getTime() + 7 * DAY);
      expect(await module.sendDue()).toEqual({ emails: 1, failed: 0 });
      clock.now = new Date(MONDAY.getTime() + 14 * DAY);
      expect(await module.sendDue()).toEqual({ emails: 0, failed: 0 });

      expect(outbox.map((message) => message.subject)).toEqual(["Nouveauté Jobbbox : Titre 0.2.0", "Nouveauté Jobbbox : Titre 0.3.0"]);
    });

    it("sends one email when two workers run at once", async () => {
      const module = emails(written(["0.2.0"], ["0.3.0"]));
      await module.subscribe("marie");
      const runs = await Promise.all([module.sendDue(), emails(written(["0.2.0"], ["0.3.0"])).sendDue()]);
      expect(runs.reduce((sum, run) => sum + run.emails, 0)).toBe(1);
      expect(outbox).toHaveLength(1);
    });

    it("sends nothing of a note not announced, of a later Version, nor of one promoted before the Candidate subscribed", async () => {
      const module = emails(written(["0.1.0", { date: "2026-10-01" }], ["0.2.0", { announce: false }], ["0.4.0"]));
      await module.subscribe("marie");
      expect(await module.sendDue()).toEqual({ emails: 0, failed: 0 });
      expect(outbox).toEqual([]);
    });

    it("sends nothing from the Beta, nor anywhere but Production, nor to an unverified address", async () => {
      await candidate("unverified", "unverified@example.fr", "fr", false);
      await emails(written()).subscribe("unverified");
      await emails(written()).subscribe("marie");
      expect(await emails(written(["0.3.0"]), { production: false }).sendDue()).toEqual({ emails: 0, failed: 0 });
      expect(await emails(written(["0.3.0"])).sendDue()).toEqual({ emails: 1, failed: 0 });
      expect(outbox.map((message) => message.to)).toEqual(["marie@example.fr"]);
    });

    it("leaves a failed email to the next run, the others sent all the same", async () => {
      const module = emails(written(["0.3.0"]));
      await module.subscribe("marie");
      await module.subscribe("john");
      refusing.add("john@example.com");
      expect(await module.sendDue()).toEqual({ emails: 1, failed: 1 });
      refusing.clear();
      expect(await module.sendDue()).toEqual({ emails: 1, failed: 0 });
      expect(outbox.map((message) => message.to)).toEqual(["marie@example.fr", "john@example.com"]);
    });
  });

  describe("unsubscribeByToken — the email's link, with no sign-in", () => {
    it("unsubscribes the Candidate its token names, once; a new subscription gets a new token", async () => {
      const module = emails(written(["0.3.0"]));
      await module.subscribe("marie");
      await module.sendDue();
      const token = /token=([A-Za-z0-9_-]{43})/.exec(outbox[0]!.text)![1]!;

      expect(await module.unsubscribeByToken("not-a-token")).toBe(false);
      expect(await module.unsubscribeByToken(token)).toBe(true);
      expect(await module.setting("marie")).toEqual({ subscribed: false, subscribedAt: null });
      expect(await module.unsubscribeByToken(token)).toBe(false);

      await module.subscribe("marie");
      expect(await module.unsubscribeByToken(token)).toBe(false);
      expect((await module.setting("marie")).subscribed).toBe(true);
    });

    it("is gone with the account", async () => {
      const module = emails(written(["0.3.0"]));
      await module.subscribe("marie");
      await module.sendDue();
      await database.query(`DELETE FROM candidate WHERE id = 'marie'`);
      expect(await nouveautesEmailOf(database, "marie")).toEqual({ subscribed: false, subscribedAt: null, sent: [] });
    });
  });
});
