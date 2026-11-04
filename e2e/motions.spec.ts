import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import { readMotionScripts } from "@jobhub/help/motion-scripts-content";
import { applicationsResponseSchema } from "@jobhub/shared/reads";
import { captureMotion, CaptureError } from "../packages/motions/src/capture";
import { DEMO_APPLICATIONS, DEMO_EMAIL, seedDemoCandidate } from "../packages/motions/src/demo-seed";
import { stepDurations } from "../packages/motions/src/narration";
import { failure, fixturesDir, motionDir, readNarration, readPlan, scriptOf, writeStageError } from "../packages/motions/src/run";
import type { Capture } from "../packages/motions/src/timeline";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";

// Issue #567 (ADR-0066): the motions' captures. Playwright films a Motion Script on the demo data (the demo Candidate,
// seeded through the app's API on this run's throwaway database), at desktop width, in French and in English.
// With MOTIONS_WORK set, the `motions` workflow's capture stage: it films every motion of that run's plan.json, holding
// each step as long as its narration, and writes capture-error.txt for a capture that breaks, without failing.
// Without it, CI's check: the test fixtures (packages/motions/fixtures) are filmed, and the broken one breaks on its step.
const origin = process.env.E2E_WEB_ORIGIN!;
const work = process.env.MOTIONS_WORK;

/** The demo Candidate, signed in and seeded in `locale`: its session for the capture's own context. */
async function demoSession(browser: Browser, locale: "fr" | "en") {
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await signInWithMagicLink(page, DEMO_EMAIL);
  await seedDemoCandidate(page.request, origin, locale);
  const state = await context.storageState();
  await context.close();
  return state;
}

test.describe("motions: the capture stage of a run", () => {
  test.skip(!work, "MOTIONS_WORK names no run");
  // One test per motion, each with its own time: a capture that hangs or breaks costs that motion only.
  for (const motion of work && existsSync(path.join(work, "plan.json")) ? readPlan(work) : []) {
    test(`films ${motion.id} in ${motion.locale}`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      if (failure(work!, motion)) return;
      try {
        const script = scriptOf(motion);
        const storageState = script.viewer === "candidate" ? await demoSession(browser, motion.locale) : undefined;
        const durations = stepDurations(readNarration(work!, motion));
        await captureMotion({ browser, script, baseURL: origin, dir: motionDir(work!, motion), durations, storageState });
      } catch (error) {
        writeStageError(work!, motion, "capture", error);
      }
    });
  }
});

test.describe("motions: the test Motion Scripts", () => {
  test.skip(!!work, "a run films its own plan");
  const fixtures = readMotionScripts(fixturesDir);
  let dir: string;
  test.beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "jobhub-motions-"));
  });
  test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

  for (const locale of ["fr", "en"] as const) {
    test(`films the demo Candidate's applications in ${locale === "fr" ? "French" : "English"}, each step held for its narration`, async ({ browser }) => {
      test.setTimeout(120_000);
      const script = fixtures[locale].find((candidate) => candidate.id === "essai-candidatures")!;
      const storageState = await demoSession(browser, locale);
      const capture = await captureMotion({ browser, script, baseURL: origin, dir, durations: [1500, 1500], storageState, typingDelay: 10, pointerPause: 100 });

      expect(existsSync(path.join(dir, "capture.webm"))).toBe(true);
      const written = JSON.parse(readFileSync(path.join(dir, "capture.json"), "utf8")) as Capture & { warnings: string[] };
      expect(written).toMatchObject({ video: "capture.webm", width: 1280, height: 720, warnings: [] });
      expect(written.steps).toHaveLength(2);
      for (const step of written.steps) expect(step.end - step.start).toBeGreaterThanOrEqual(1500);
      expect(written.steps[1]!.start).toBeGreaterThanOrEqual(written.steps[0]!.end);
      // The first step zooms on the page's main content; the second leaves the zoom.
      expect(written.steps[0]!.zoom).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
      expect(written.steps[1]!.zoom).toBeNull();
      expect(capture.visited[0]).toBe("/candidatures");
      expect(capture.visited.at(-1)).toMatch(/^\/candidatures\/[^/]+$/);
    });
  }

  // Every capture seeds the demo Candidate again: the seed saves its Applications once, and a later seed leaves them as
  // they are (a status a capture changed included), whatever GET /api/applications' shape (#684 made it Mes candidatures'
  // card, { applications, toHandle, archivedHidden }).
  test("seeding the demo Candidate again saves no Application twice and changes none", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    await signInWithMagicLink(page, newAddress("motions-seed"));
    await seedDemoCandidate(page.request, origin, "fr");
    const writes: string[] = [];
    const watched = new Proxy(page.request, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        return (url: string, ...rest: unknown[]) => {
          if (["post", "patch", "put", "delete", "fetch"].includes(String(property)) && /^\/api\/(job-offers|applications)/.test(url)) writes.push(`${String(property)} ${url}`);
          return (value as (...args: unknown[]) => unknown).apply(target, [url, ...rest]);
        };
      },
    });
    await seedDemoCandidate(watched, origin, "fr");
    expect(writes).toEqual([]);

    const listed = await page.request.get("/api/applications");
    expect(listed.status(), await listed.text()).toBe(200);
    const { applications } = applicationsResponseSchema.parse(await listed.json());
    expect(applications.map(({ title }) => title).sort()).toEqual(DEMO_APPLICATIONS.map(({ title }) => title).sort());
    await context.close();
  });

  test("a capture whose element is missing breaks on its step, naming it, and leaves no video", async ({ browser }) => {
    test.setTimeout(120_000);
    const script = fixtures.fr.find((candidate) => candidate.id === "essai-capture-cassee")!;
    const storageState = await demoSession(browser, "fr");
    const capture = captureMotion({ browser, script, baseURL: origin, dir, durations: [200, 200], storageState, pointerPause: 0 });

    const error = await capture.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(CaptureError);
    expect((error as CaptureError).step).toBe(1);
    expect((error as CaptureError).message).toContain(`étape 2 « Un bouton qui n'existe pas » : click button "Ce bouton n'existe pas"`);
    expect(existsSync(path.join(dir, "capture.webm"))).toBe(false);
    expect(existsSync(path.join(dir, "capture.json"))).toBe(false);
  });

  test("a run's capture stage writes the broken capture down and films the others", async ({ browser }) => {
    test.setTimeout(180_000);
    const plan = ["essai-candidatures", "essai-capture-cassee"].map((id) => ({ id, locale: "fr" as const, hash: "test", scriptsDir: fixturesDir, reason: "named" as const }));
    writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
    for (const motion of plan) {
      mkdirSync(motionDir(dir, motion), { recursive: true });
      const steps = [{ sentences: [], duration: 0.5 }, { sentences: [], duration: 0.5 }];
      writeFileSync(path.join(motionDir(dir, motion), "narration.json"), JSON.stringify({ provider: "espeak", voice: "fr", publishable: false, steps }));
    }
    const storageState = await demoSession(browser, "fr");
    for (const motion of readPlan(dir)) {
      try {
        await captureMotion({ browser, script: scriptOf(motion), baseURL: origin, dir: motionDir(dir, motion), durations: stepDurations(readNarration(dir, motion)), storageState, pointerPause: 0 });
      } catch (error) {
        writeStageError(dir, motion, "capture", error);
      }
    }
    expect(failure(dir, plan[0]!)).toBeNull();
    expect(existsSync(path.join(motionDir(dir, plan[0]!), "capture.webm"))).toBe(true);
    expect(failure(dir, plan[1]!)).toMatchObject({ stage: "capture", error: expect.stringContaining("Ce bouton n'existe pas") });
  });
});
