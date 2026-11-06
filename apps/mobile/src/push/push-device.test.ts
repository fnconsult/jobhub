import { memoryStorage } from "../offline/testing";
import { createPushDevice, type DeviceNotifications, type SystemPermission } from "./push-device";

const TOKEN = "a1".repeat(32);

/** The system's notifications, answering as the person and the device would. */
function fakeSystem(start: SystemPermission = { status: "undetermined", canAskAgain: true }) {
  let permission = start;
  let token = TOKEN;
  const system = {
    /** What the system's prompt answers. */
    answer: { status: "granted", canAskAgain: true } as SystemPermission,
    prompts: 0,
    notifications: {
      permission: async () => permission,
      request: async () => {
        system.prompts += 1;
        permission = system.answer;
        return permission;
      },
      token: async () => token,
    } satisfies DeviceNotifications,
    /** The person changed it in the device's settings. */
    set: (next: SystemPermission) => void (permission = next),
    rotate: (next: string) => void (token = next),
  };
  return system;
}

/** The platform's API, as `useApi()` gives it: each call kept, answered 204 unless `down`. */
function fakeApi() {
  const api = {
    calls: [] as { method: string; path: string; body: unknown }[],
    down: false,
    fetch: async (path: string, init?: RequestInit) => {
      if (api.down) throw new TypeError("Network request failed");
      api.calls.push({ method: init?.method ?? "GET", path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      return new Response(null, { status: 204 });
    },
  };
  return api;
}

function setUp(start?: SystemPermission, platform: "ios" | "android" = "ios") {
  const system = fakeSystem(start);
  const api = fakeApi();
  const storage = memoryStorage();
  const device = () => createPushDevice({ notifications: system.notifications, api: api.fetch, storage, platform, environment: "production", language: () => "fr" });
  return { system, api, storage, device };
}

describe("the device's Push notifications (#699)", () => {
  it("asks nothing by itself: never asked, the app may ask in context, and registers nothing", async () => {
    const { system, api, device } = setUp();
    expect(await device().permission()).toBe("notAsked");
    await device().sync();
    expect(system.prompts).toBe(0);
    expect(api.calls).toEqual([]);
  });

  it("allowed after the explanation, registers the device's token with its platform and language", async () => {
    const { api, device } = setUp();
    expect(await device().allow()).toBe("allowed");
    expect(api.calls).toEqual([{ method: "POST", path: "/api/account/push-devices", body: { platform: "ios", token: TOKEN, language: "fr", environment: "production" } }]);
    expect(await device().permission()).toBe("allowed");
  });

  it("keeps a refusal in the system's prompt: not asked again, Rappels explains the device's settings", async () => {
    const { system, api, device } = setUp();
    system.answer = { status: "denied", canAskAgain: false };
    expect(await device().allow()).toBe("refused");
    expect(await device().permission()).toBe("refused");
    expect(api.calls).toEqual([]);
  });

  it("keeps « Pas maintenant » on the explanation: not asked again in context, though the system could still ask", async () => {
    const { system, device } = setUp();
    await device().decline();
    expect(await device().permission()).toBe("declined");
    expect(system.prompts).toBe(0);
    // Allowed later from Rappels: asked then.
    expect(await device().allow()).toBe("allowed");
    expect(await device().permission()).toBe("allowed");
  });

  it("takes a system prompt swiped away (Android) for no answer: still to ask", async () => {
    const { system, device } = setUp(undefined, "android");
    system.answer = { status: "undetermined", canAskAgain: true };
    expect(await device().allow()).toBe("notAsked");
  });

  it("registers again at each start while allowed, and the new token when the system rotates it, the old one forgotten", async () => {
    const { system, api, device } = setUp({ status: "granted", canAskAgain: true });
    await device().sync();
    system.rotate("b2".repeat(32));
    await device().sync();
    expect(api.calls.map(({ method, body }) => [method, (body as { token: string }).token])).toEqual([
      ["POST", TOKEN],
      ["DELETE", TOKEN],
      ["POST", "b2".repeat(32)],
    ]);
  });

  it("forgets the device once notifications are turned off in its settings", async () => {
    const { system, api, device } = setUp({ status: "granted", canAskAgain: true });
    await device().sync();
    system.set({ status: "denied", canAskAgain: false });
    await device().sync();
    await device().sync();
    expect(api.calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
    expect(api.calls[1]).toEqual({ method: "DELETE", path: "/api/account/push-devices", body: { token: TOKEN } });
    expect(await device().permission()).toBe("refused");
  });

  it("forgets the device at sign-out, and nothing when it never registered", async () => {
    const { api, device } = setUp({ status: "granted", canAskAgain: true });
    await device().forget();
    expect(api.calls).toEqual([]);
    await device().sync();
    await device().forget();
    await device().forget();
    expect(api.calls.map(({ method }) => method)).toEqual(["POST", "DELETE"]);
  });

  it("never throws without network: it registers or forgets at the next start", async () => {
    const { api, device } = setUp({ status: "granted", canAskAgain: true });
    api.down = true;
    await expect(device().sync()).resolves.toBeUndefined();
    await expect(device().forget()).resolves.toBeUndefined();
    api.down = false;
    await device().sync();
    expect(api.calls.map(({ method }) => method)).toEqual(["POST"]);
  });
});
