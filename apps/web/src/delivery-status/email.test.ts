import { describe, expect, it } from "vitest";
import type { MailMessage } from "../auth";
import { createDeliveryStatusEmails, deliveryStatusEmail, deliveryStatusRecipients, DELIVERY_STATUS_EMAIL_TO } from "./email";
import type { DeliveryStatus, Ticket } from "./index";
import type { SignalementsDigest } from "../signalements/digest";

const ticket = (number: number, stage: Ticket["stage"]): Ticket => ({ number, title: `Ticket ${number}`, url: `https://github.com/acme/app/issues/${number}`, stage, evidence: {} });

const STATUS: DeliveryStatus = {
  repository: "acme/app",
  builtAt: "2026-11-03T17:00:00Z",
  closedDays: 14,
  environments: [
    { name: "staging", missing: false, deployment: { sha: "abcdef1234567", ref: "main", at: "2026-11-02T09:00:00Z", url: "https://staging.example", runUrl: null }, live: { checked: true, revision: "abcdef1234567" } },
    { name: "production", missing: true, deployment: null, live: null },
  ],
  mainVersusStaging: { ahead: 3, behind: 0 },
  inFlight: { tickets: [{ ticket: ticket(13, "inReview"), under: 10 }], pullRequests: [{ number: 200, title: "Chore", url: "https://github.com/acme/app/pull/200", draft: true, closes: [] }] },
  epics: [
    {
      number: 1,
      title: "Carte : Livraison",
      url: "https://github.com/acme/app/issues/1",
      closed: false,
      discovery: { closed: 1, total: 1 },
      features: [{ number: 10, title: "Suivi : Livraison (#1)", url: "https://github.com/acme/app/issues/10", direct: false, tickets: [ticket(13, "inReview"), ticket(14, "onStaging")], headline: { kind: "building", tickets: [13] }, counts: [{ stage: "inReview", count: 1 }, { stage: "onStaging", count: 1 }] }],
    },
  ],
  orphans: [],
  caveats: [{ kind: "openButMerged", issue: 11, pullRequest: 101 }, { kind: "subIssuesOnly" }, { kind: "closesOnly" }],
};

describe("the daily delivery status email", () => {
  it("names each environment and its live check, what is in flight, each feature's headline, and links to Livraison and to its setting", () => {
    const email = deliveryStatusEmail(STATUS, "https://staging.jobbbox.ai/");
    expect(email.language).toBe("fr");
    expect(email.subject).toBe("Livraison du 3 novembre 2026");
    const text = JSON.stringify(email.body);
    expect(text).toContain("Beta");
    expect(text).toContain("abcdef12");
    expect(text).toContain("Le site sert ce commit");
    expect(text).toContain("main a 3 commits d'avance sur la Beta.");
    expect(text).toContain("#13 Ticket 13");
    expect(text).toContain("PR #200 Chore");
    expect(text).toContain("En construction : #13");
    expect(text).toContain("#11 est encore ouvert");
    // The two matching limits hold every day: the email leaves them to the page.
    expect(text).not.toContain("sous-issue");
    expect(email.body).toContainEqual({ action: { label: "Ouvrir Livraison", url: "https://staging.jobbbox.ai/admin/livraison" } });
    expect(email.footer.link?.url).toMatch(/^https:\/\/staging\.jobbbox\.ai\/admin\/parametres\?tab=e-mail#setting-DELIVERY_STATUS_EMAIL_TO$/);
  });

  describe("its « Signalements » section (#1141)", () => {
    const DIGEST: SignalementsDigest = {
      environment: "production",
      newByType: { bug: 2, idee: 1, question: 0 },
      issues: [
        { number: 1201, kind: "opened", signalements: 2, url: "https://github.com/fnconsult/jobhub/issues/1201" },
        { number: 1188, kind: "commented", signalements: 1, url: "https://github.com/fnconsult/jobhub/issues/1188" },
      ],
      readyWithDraft: 3,
      triage: { ran: true, at: new Date("2026-11-03T16:05:00Z") },
    };

    it("gives the new Signalements by type and environment, the issues opened or completed with a duplicate, those « Prêt à clore » waiting for Support, and the triage's last pass", () => {
      const email = deliveryStatusEmail(STATUS, "https://jobbbox.ai", "fr", DIGEST);
      const text = JSON.stringify(email.body);

      expect(email.body).toContain("Signalements");
      expect(text).toContain("Nouveaux signalements en Production : 2 bugs, 1 idée, 0 question");
      expect(email.body).toContainEqual({ card: { title: "#1201", details: ["Ouverte pour 2 signalements"], url: "https://github.com/fnconsult/jobhub/issues/1201" } });
      expect(email.body).toContainEqual({ card: { title: "#1188", details: ["Complétée par un doublon : 1 signalement"], url: "https://github.com/fnconsult/jobhub/issues/1188" } });
      expect(text).toContain("Prêts à clore, brouillon à envoyer par Support : 3");
      expect(email.body).toContainEqual({ link: { label: "Ouvrir les signalements", url: "https://jobbbox.ai/admin/signalements" } });
      expect(text).toContain("Dernier passage du tri : 3 nov. 2026, 17:05");
    });

    it("says why the triage did not run", () => {
      for (const [reason, words] of [
        ["no_key", "aucune clé d'agent"],
        ["key_expired", "clé échue"],
        ["key_revoked", "clé révoquée"],
        ["no_call", "aucun appel ce jour"],
      ] as const) {
        const text = JSON.stringify(deliveryStatusEmail(STATUS, "https://jobbbox.ai", "fr", { ...DIGEST, triage: { ran: false, reason } }).body);
        expect(text).toContain(`Le tri n'a pas eu lieu : ${words}.`);
      }
    });

    it("says when no issue was opened, and is left out without figures", () => {
      expect(JSON.stringify(deliveryStatusEmail(STATUS, "https://jobbbox.ai", "fr", { ...DIGEST, issues: [] }).body)).toContain("Aucune issue ouverte ni complétée.");
      expect(deliveryStatusEmail(STATUS, "https://jobbbox.ai").body).not.toContain("Signalements");
    });

    it("is sent with the email, and the email still goes when it cannot be computed", async () => {
      const sent: MailMessage[] = [];
      const mailer = { send: async (message: MailMessage) => void sent.push(message) };
      const env = () => ({ [DELIVERY_STATUS_EMAIL_TO]: "dev@jobbbox.ai", GITHUB_STATUS_TOKEN: "t" });

      await createDeliveryStatusEmails({ mailer, baseURL: "https://jobbbox.ai", env, read: async () => STATUS, signalements: async () => DIGEST }).send();
      await createDeliveryStatusEmails({ mailer, baseURL: "https://jobbbox.ai", env, read: async () => STATUS, signalements: async () => Promise.reject(new Error("down")) }).send();

      expect(sent.map((message) => message.text.includes("Nouveaux signalements"))).toEqual([true, false]);
    });
  });

  it("reads its recipients from the setting: commas or spaces, addresses only, once each", () => {
    expect(deliveryStatusRecipients(undefined)).toEqual([]);
    expect(deliveryStatusRecipients("")).toEqual([]);
    expect(deliveryStatusRecipients(" dev@jobbbox.ai, ops@jobbbox.ai;dev@jobbbox.ai not-an-address ")).toEqual(["dev@jobbbox.ai", "ops@jobbbox.ai"]);
  });

  it("sends one email to each recipient after reading GitHub once; nothing without recipients or token", async () => {
    const sent: MailMessage[] = [];
    const reads: [string, string][] = [];
    const deps = (env: Record<string, string | undefined>) => ({
      mailer: { send: async (message: MailMessage) => void sent.push(message) },
      baseURL: "https://app.example",
      env: () => env,
      read: async (token: string, repository: string) => {
        reads.push([token, repository]);
        return STATUS;
      },
    });

    expect(await createDeliveryStatusEmails(deps({ GITHUB_STATUS_TOKEN: "t" })).send()).toEqual({ skipped: "noRecipients" });
    expect(await createDeliveryStatusEmails(deps({ [DELIVERY_STATUS_EMAIL_TO]: "dev@jobbbox.ai" })).send()).toEqual({ skipped: "missingToken" });
    expect(reads).toEqual([]);

    expect(await createDeliveryStatusEmails(deps({ [DELIVERY_STATUS_EMAIL_TO]: "dev@jobbbox.ai, ops@jobbbox.ai", GITHUB_STATUS_TOKEN: "t" })).send()).toEqual({ sent: 2, failed: 0 });
    expect(reads).toEqual([["t", "fnconsult/jobhub"]]);
    expect(sent.map((m) => m.to)).toEqual(["dev@jobbbox.ai", "ops@jobbbox.ai"]);
    expect(sent[0]!.subject).toBe("Livraison du 3 novembre 2026");
    expect(sent[0]!.html).toContain("Ouvrir Livraison");
  });

  it("counts a recipient its mailer refuses, and still sends to the others", async () => {
    const sent: string[] = [];
    const emails = createDeliveryStatusEmails({
      mailer: {
        send: async ({ to }: MailMessage) => {
          if (to === "bad@jobbbox.ai") throw new Error("refused");
          sent.push(to);
        },
      },
      baseURL: "https://app.example",
      env: () => ({ [DELIVERY_STATUS_EMAIL_TO]: "bad@jobbbox.ai, dev@jobbbox.ai", GITHUB_STATUS_TOKEN: "t", GITHUB_STATUS_REPOSITORY: "acme/app" }),
      read: async () => STATUS,
    });
    expect(await emails.send()).toEqual({ sent: 1, failed: 1 });
    expect(sent).toEqual(["dev@jobbbox.ai"]);
  });
});
