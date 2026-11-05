import { APP_ORIGIN } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { isFromTheApp } from "./app-requests";

const request = (headers: Record<string, string>) => new Request("http://localhost:3000/api/account/push-devices", { method: "POST", headers });

describe("a request from the native app (ADR-0076)", () => {
  it("states the app's origin in `expo-origin`, with no Origin of its own", () => {
    expect(isFromTheApp(request({ "expo-origin": APP_ORIGIN }))).toBe(true);
  });

  it("is not one with another app's origin, none at all, or a browser's Origin beside it", () => {
    expect(isFromTheApp(request({ "expo-origin": "otherapp://" }))).toBe(false);
    expect(isFromTheApp(request({}))).toBe(false);
    expect(isFromTheApp(request({ "expo-origin": APP_ORIGIN, origin: "https://evil.example" }))).toBe(false);
  });
});
