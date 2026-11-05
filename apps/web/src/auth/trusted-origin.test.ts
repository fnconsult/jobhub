import { APP_ORIGIN } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "./trusted-origin";

const TRUSTED = ["https://jobbbox.ai", "chrome-extension://abc", APP_ORIGIN];

describe("whether a state-changing request comes from Jobbbox itself", () => {
  it("is so from the web app, the extension or the native app, by its Origin", () => {
    for (const origin of TRUSTED) expect(isTrustedOrigin(new Headers({ origin }), TRUSTED), origin).toBe(true);
  });

  it("is not from another site, nor without any origin", () => {
    expect(isTrustedOrigin(new Headers({ origin: "https://evil.example" }), TRUSTED)).toBe(false);
    expect(isTrustedOrigin(new Headers(), TRUSTED)).toBe(false);
  });

  it("takes the native app's own header when no Origin is sent, as Better Auth's Expo plugin does (#688)", () => {
    expect(isTrustedOrigin(new Headers({ "expo-origin": APP_ORIGIN }), TRUSTED)).toBe(true);
    expect(isTrustedOrigin(new Headers({ "expo-origin": "otherapp://" }), TRUSTED)).toBe(false);
  });

  it("never lets that header stand in for a browser's Origin: a page of another site is refused", () => {
    expect(isTrustedOrigin(new Headers({ origin: "https://evil.example", "expo-origin": APP_ORIGIN }), TRUSTED)).toBe(false);
  });
});
