import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

/** The app registers a device, as it does while signed in (POST /api/account/push-devices). */
export const registerDevice = (page: Page, device: Record<string, unknown>) =>
  page.request.post("/api/account/push-devices", { headers: { origin: process.env.E2E_WEB_ORIGIN! }, data: device });

/** Runs the worker's send job once for `email`'s `event`, with fake providers (e2e/support/push-send.ts). */
export function sendPush(email: string, event: string, mode = "fake") {
  const run = spawnSync(path.resolve("node_modules/.bin/tsx"), ["e2e/support/push-send.ts", email, event, mode], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL },
    encoding: "utf8",
  });
  expect(run.status, run.stderr).toBe(0);
  const line = run.stdout.trim().split("\n").at(-1)!;
  return JSON.parse(line) as { before: number; after: number; messages: { title: string; body: string; path: string }[]; log: string[] };
}

/**
 * The events queued as Push notifications for the person signed in on `page`, oldest first, as their Data export lists
 * them (`pushNotifications.sent`): one per event, whatever ran again, and none for a switch turned off.
 */
export async function queuedPushEvents(page: Page): Promise<string[]> {
  const exported = await page.request.get("/api/account/export");
  expect(exported.ok(), await exported.text()).toBe(true);
  return ((await exported.json()).pushNotifications.sent as { event: string }[]).map((sent) => sent.event);
}

/** Switches `event` off in Rappels (PUT /api/account/push-notifications). */
export async function switchPush(page: Page, event: string, enabled: boolean) {
  const response = await page.request.put("/api/account/push-notifications", { headers: { origin: process.env.E2E_WEB_ORIGIN! }, data: { event, enabled } });
  expect(response.status(), await response.text()).toBe(200);
}
