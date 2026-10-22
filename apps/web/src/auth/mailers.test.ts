import { describe, expect, it, vi } from "vitest";
import type { ExternalApiCall } from "@jobhub/shared";
import { createPlatformSettingsResolver, type StoredPlatformSettings } from "../platform-settings/resolver";
import { createSecretResolver, type StoredSecrets } from "../provider-secrets/resolver";
import { BrevoApiError, brevoApiMailer, liveMailer, mailerFromEnv, parseSender } from "./mailers";

const reply = (status: number, body = "{}") => new Response(body, { status });

describe("brevoApiMailer", () => {
  it("sends the email through Brevo's transactional API with the API key", async () => {
    const fetch = vi.fn(async () => reply(201, '{"messageId":"<1@brevo>"}'));
    const mailer = brevoApiMailer("xkeysib-test", "Jobbbox <bonjour@jobbbox.fr>", { fetch });

    await mailer.send({ to: "ada@example.com", subject: "Your link", text: "Hello", headers: { "List-Unsubscribe": "<https://x/u>" } });

    expect(fetch).toHaveBeenCalledWith("https://api.brevo.com/v3/smtp/email", expect.objectContaining({ method: "POST" }));
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: "Jobbbox", email: "bonjour@jobbbox.fr" },
      to: [{ email: "ada@example.com" }],
      subject: "Your link",
      textContent: "Hello",
      headers: { "List-Unsubscribe": "<https://x/u>" },
    });
  });

  it("throws Brevo's status, so a refused key (401) is read again from the Provider Secrets", async () => {
    const mailer = brevoApiMailer("xkeysib-bad", "bonjour@jobbbox.fr", { fetch: async () => reply(401, '{"code":"unauthorized"}') });
    await expect(mailer.send({ to: "ada@example.com", subject: "s", text: "t" })).rejects.toMatchObject({ status: 401 });
    await expect(mailer.send({ to: "ada@example.com", subject: "s", text: "t" })).rejects.toBeInstanceOf(BrevoApiError);
  });

  it("uses BREVO_API_URL when given", async () => {
    const fetch = vi.fn(async () => reply(201));
    await brevoApiMailer("k", "a@b.c", { apiUrl: "http://127.0.0.1:9999/v3/", fetch }).send({ to: "x@y.z", subject: "s", text: "t" });
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:9999/v3/smtp/email", expect.anything());
  });
});

describe("parseSender", () => {
  it("reads a name and address, or a bare address", () => {
    expect(parseSender("Jobbbox <hello@jobbbox.ai>")).toEqual({ name: "Jobbbox", email: "hello@jobbbox.ai" });
    expect(parseSender('"Jobbbox" <hello@jobbbox.ai>')).toEqual({ name: "Jobbbox", email: "hello@jobbbox.ai" });
    expect(parseSender("hello@jobbbox.ai")).toEqual({ email: "hello@jobbbox.ai" });
  });
});

describe("mailerFromEnv", () => {
  const production = { NODE_ENV: "production", MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>" };

  it("prefers Brevo's API key over SMTP_URL", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(201));
    try {
      await mailerFromEnv({ ...production, BREVO_API_KEY: "xkeysib-1", SMTP_URL: "smtp://u:p@smtp.example:587" }).send({ to: "x@y.z", subject: "s", text: "t" });
      expect(fetch).toHaveBeenCalledWith("https://api.brevo.com/v3/smtp/email", expect.anything());
    } finally {
      fetch.mockRestore();
    }
  });

  it("refuses to run in production without BREVO_API_KEY or SMTP_URL", () => {
    expect(() => mailerFromEnv(production)).toThrow(/BREVO_API_KEY or SMTP_URL/);
    expect(() => mailerFromEnv({ ...production, BREVO_API_KEY: "xkeysib-1" })).not.toThrow();
    expect(() => mailerFromEnv({ NODE_ENV: "production", BREVO_API_KEY: "xkeysib-1" })).toThrow(/MAIL_FROM/);
  });
});

describe("the emails sent, as recorded", () => {
  const production = { NODE_ENV: "production", MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>" };
  const message = { to: "marie.dupont@example.fr", subject: "Votre lien de connexion", text: "https://jobbbox.ai/api/auth/magic-link/verify?token=abc" };

  it("records each email sent through Brevo's API, with its status and duration; never who it was for nor what it said", async () => {
    const calls: ExternalApiCall[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(201)).mockResolvedValueOnce(reply(401));
    try {
      const mailer = mailerFromEnv({ ...production, BREVO_API_KEY: "xkeysib-abcdefghijkl" }, { externalApis: { record: (call) => void calls.push(call) } });
      await mailer.send(message);
      await expect(mailer.send(message)).rejects.toBeInstanceOf(BrevoApiError);
    } finally {
      fetch.mockRestore();
    }

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "brevo", operation: "send", ok: true, httpStatus: 201 },
      { provider: "brevo", operation: "send", ok: false, httpStatus: 401 },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/marie|example\.fr|lien|token|xkeysib/i);
  });

  it("records each email sent through the SMTP relay, a refused one too", async () => {
    const calls: ExternalApiCall[] = [];
    const mailer = mailerFromEnv(
      { ...production, SMTP_URL: "smtp://user:secret@smtp-relay.brevo.com:587" },
      {
        externalApis: { record: (call) => void calls.push(call) },
        smtpTransport: { sendMail: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error("Mailbox unavailable"), { responseCode: 550 })) },
      },
    );

    await mailer.send(message);
    await expect(mailer.send(message)).rejects.toThrow("Mailbox unavailable");

    expect(calls.map(({ provider, operation, ok, httpStatus }) => ({ provider, operation, ok, httpStatus }))).toEqual([
      { provider: "brevo_smtp", operation: "send", ok: true, httpStatus: null },
      { provider: "brevo_smtp", operation: "send", ok: false, httpStatus: null },
    ]);
    expect(JSON.stringify(calls)).not.toMatch(/marie|secret|token/i);
  });

  it("records nothing for the console, which sends nothing", async () => {
    const calls: ExternalApiCall[] = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await mailerFromEnv({ MAIL_TRANSPORT: "console" }, { externalApis: { record: (call) => void calls.push(call) } }).send(message);
    } finally {
      info.mockRestore();
    }
    expect(calls).toEqual([]);
  });

  it("sends the email even when it cannot be recorded", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply(201));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mailer = mailerFromEnv({ ...production, BREVO_API_KEY: "xkeysib-1" }, { externalApis: { record: () => Promise.reject(new Error("insert failed")) } });
      await expect(mailer.send(message)).resolves.toBeUndefined();
    } finally {
      fetch.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("liveMailer: the app's and the worker's mailer, on the Provider Secrets and the Platform Settings in use (#300)", () => {
  const message = { to: "marie.dupont@example.fr", subject: "Votre lien de connexion", text: "https://jobbbox.ai/api/auth/magic-link/verify?token=abc" };

  /** Brevo's key in the Clés section and MAIL_FROM on Paramètres, as a test edits them, over `env`. */
  function backOffice(env: Record<string, string>) {
    const secrets: { current: StoredSecrets } = { current: {} };
    const settings: { current: StoredPlatformSettings } = { current: {} };
    const sources = {
      secrets: createSecretResolver({ load: async () => secrets.current, env, log: () => {} }),
      settings: createPlatformSettingsResolver({ load: async () => settings.current, env, log: () => {} }),
    };
    return {
      sources,
      setKey: (value: string) => (secrets.current = { BREVO_API_KEY: { value, row: value } }),
      setSender: (value: string) => (settings.current = { MAIL_FROM: { value, updatedBy: "ops@jobbbox.ai", updatedAt: new Date() } }),
      restoreSender: () => (settings.current = {}),
      refresh: () => Promise.all([sources.secrets.refresh(), sources.settings.refresh()]),
    };
  }

  /** What each email was sent through Brevo with: its key and its sender. */
  function brevo() {
    const sent: { key: string; sender: unknown }[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_, init) => {
      sent.push({ key: (init!.headers as Record<string, string>)["api-key"]!, sender: JSON.parse(init!.body as string).sender });
      return reply(201);
    });
    return { sent, restore: () => fetch.mockRestore() };
  }

  it("sends the next email as the sender saved on Paramètres, and as env's again once restored, without being built again", async () => {
    const office = backOffice({ NODE_ENV: "production", BREVO_API_KEY: "xkeysib-env", MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>" });
    await office.refresh();
    const mailer = liveMailer(office.sources);
    const api = brevo();
    try {
      await mailer.send(message);
      office.setSender("Jobbbox <hello@jobbbox.ai>");
      await office.refresh();
      await mailer.send(message);
      office.restoreSender();
      await office.refresh();
      await mailer.send(message);
    } finally {
      api.restore();
    }

    expect(api.sent.map(({ sender }) => sender)).toEqual([
      { name: "Jobbbox", email: "bonjour@jobbbox.fr" },
      { name: "Jobbbox", email: "hello@jobbbox.ai" },
      { name: "Jobbbox", email: "bonjour@jobbbox.fr" },
    ]);
  });

  it("keeps the sender saved on Paramètres when Brevo's key is replaced in the Clés section, and the other way round", async () => {
    const office = backOffice({ NODE_ENV: "production", BREVO_API_KEY: "xkeysib-env", MAIL_FROM: "bonjour@jobbbox.fr" });
    office.setSender("hello@jobbbox.ai");
    await office.refresh();
    const mailer = liveMailer(office.sources);
    const api = brevo();
    try {
      await mailer.send(message);
      office.setKey("xkeysib-back-office");
      await office.refresh();
      await mailer.send(message);
    } finally {
      api.restore();
    }

    expect(api.sent).toEqual([
      { key: "xkeysib-env", sender: { email: "hello@jobbbox.ai" } },
      { key: "xkeysib-back-office", sender: { email: "hello@jobbbox.ai" } },
    ]);
  });

  it("sends in production with a sender only Paramètres holds; with none anywhere, the email fails naming MAIL_FROM", async () => {
    const office = backOffice({ NODE_ENV: "production", BREVO_API_KEY: "xkeysib-env" });
    await office.refresh();
    const mailer = liveMailer(office.sources);
    const api = brevo();
    try {
      await expect(async () => mailer.send(message)).rejects.toThrow(/MAIL_FROM/);
      office.setSender("Jobbbox <hello@jobbbox.ai>");
      await office.refresh();
      await mailer.send(message);
    } finally {
      api.restore();
    }

    expect(api.sent.map(({ sender }) => sender)).toEqual([{ name: "Jobbbox", email: "hello@jobbbox.ai" }]);
  });
});
