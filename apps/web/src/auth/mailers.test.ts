import { describe, expect, it, vi } from "vitest";
import type { ExternalApiCall } from "@jobhub/shared";
import { BrevoApiError, brevoApiMailer, mailerFromEnv, parseSender } from "./mailers";

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
