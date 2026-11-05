import { TOOLS } from "@jobhub/shared";
import { describe, expect, it } from "vitest";
import { pushPlatformOfTool } from "./senders";

describe("the Push notification Tools", () => {
  it("are APNs for iOS and FCM for Android, both in the catalog's push category; no other Tool sends one", () => {
    expect(pushPlatformOfTool("apns")).toBe("ios");
    expect(pushPlatformOfTool("fcm")).toBe("android");
    expect(TOOLS.filter((tool) => pushPlatformOfTool(tool.id) !== null).map((tool) => [tool.id, tool.category])).toEqual([
      ["apns", "push"],
      ["fcm", "push"],
    ]);
  });
});
