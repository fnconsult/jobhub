import { describe, expect, it } from "vitest";
import { authConfigFromEnv } from "./config";

const base = {
  DATABASE_URL: "postgres://jobhub:jobhub@localhost:5433/jobhub",
  APP_URL: "https://app.jobbbox.fr",
  AUTH_SECRET: "a-very-long-secret-of-at-least-32-chars",
  SMTP_URL: "smtp://user:pass@smtp.example.eu:587",
  MAIL_FROM: "Jobbbox <bonjour@jobbbox.fr>",
};

describe("authConfigFromEnv", () => {
  it("offers Google sign-in only when its client is configured", () => {
    expect(authConfigFromEnv(base).google).toBeUndefined();
    expect(
      authConfigFromEnv({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).google,
    ).toEqual({ clientId: "id", clientSecret: "secret" });
  });

  it("trusts the comma-separated extension origins", () => {
    const config = authConfigFromEnv({
      ...base,
      EXTENSION_ORIGINS: "chrome-extension://aaa, chrome-extension://bbb",
    });
    expect(config.extensionOrigins).toEqual(["chrome-extension://aaa", "chrome-extension://bbb"]);
  });

  it("refuses to run in production without a secret or an SMTP server", () => {
    expect(() => authConfigFromEnv({ ...base, NODE_ENV: "production", AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
    expect(() => authConfigFromEnv({ ...base, NODE_ENV: "production", SMTP_URL: undefined })).toThrow(/SMTP_URL/);
  });

  it("runs in development with defaults, printing sign-in emails to the console", () => {
    const config = authConfigFromEnv({ DATABASE_URL: base.DATABASE_URL, NODE_ENV: "development" });
    expect(config.baseURL).toBe("http://localhost:3000");
    expect(config.secret.length).toBeGreaterThanOrEqual(32);
  });

  it("prints emails to the console in a production build only when explicitly asked (local e2e runs)", () => {
    expect(() =>
      authConfigFromEnv({ ...base, NODE_ENV: "production", SMTP_URL: undefined, MAIL_TRANSPORT: "console" }),
    ).not.toThrow();
  });
});
