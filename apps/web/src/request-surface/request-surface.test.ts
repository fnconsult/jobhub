import { API_CLIENT_HEADER, APP_ORIGIN, MOBILE_CLIENT } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { requestSurface } from "./index";

const WEB = "https://jobbbox.ai";

describe("the Surface a request comes from (#919)", () => {
  it("is the web app by its own Origin, the extension by an extension's, the app by its scheme", () => {
    expect(requestSurface(new Headers({ origin: WEB }), WEB)).toBe("web");
    expect(requestSurface(new Headers({ origin: "chrome-extension://abc" }), WEB)).toBe("extension");
    expect(requestSurface(new Headers({ origin: "moz-extension://abc" }), WEB)).toBe("extension");
    expect(requestSurface(new Headers({ origin: APP_ORIGIN }), WEB)).toBe("app");
  });

  it("is the app when no Origin is sent but its own header (expo-origin, or its client name on a GET)", () => {
    expect(requestSurface(new Headers({ "expo-origin": APP_ORIGIN }), WEB)).toBe("app");
    expect(requestSurface(new Headers({ [API_CLIENT_HEADER]: MOBILE_CLIENT }), WEB)).toBe("app");
  });

  it("is the extension on its GET, which carries no Origin: a fetch no page started", () => {
    expect(requestSurface(new Headers({ "sec-fetch-site": "none", "sec-fetch-mode": "cors" }), WEB)).toBe("extension");
  });

  it("is none for another site, an address typed in the bar, or nothing said", () => {
    expect(requestSurface(new Headers({ origin: "https://evil.example" }), WEB)).toBeNull();
    expect(requestSurface(new Headers({ origin: "https://evil.example", "expo-origin": APP_ORIGIN }), WEB)).toBeNull();
    expect(requestSurface(new Headers({ "sec-fetch-site": "none", "sec-fetch-mode": "navigate" }), WEB)).toBeNull();
    expect(requestSurface(new Headers(), WEB)).toBeNull();
  });
});
