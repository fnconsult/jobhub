/**
 * Runs the app's Maestro flows on the simulator or emulator a CI job booted (#705, docs/ops/mobile.md), against the
 * seeded test stack (e2e/mobile-stack.spec.ts), each run of `runsOn(hardware)` in turn:
 *
 *   npx tsx apps/mobile/maestro/run.ts <hardware> --stack <ready.json> [--captures compare|record|off] [--out <dir>]
 *
 * The hardware first set to French, then for each run: the device set up (theme, text size, fold, status bar), a new seeded Candidate, the app prepared
 * (cleared, oriented), then the run's flows. A run with missing reference captures draws them and
 * fails, as a missing web baseline does; `record` draws them all again, on purpose. Each run's JUnit report, screenshots
 * and Maestro's logs go to `<out>/<run>`; the captures to apps/mobile/maestro/captures.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bootSetup, CI_HARDWARE, runsOn, type HardwareId } from "./devices";
import { KEY_SCREENS } from "./seed";
import { prepareIOSRun } from "./ios-driver-recovery";

/** The flow of the key screens (tag `key-screens`), run alone in the dark theme and at the largest text size. */
export const KEY_SCREENS_FLOW = "flows/2-ecrans-cles.yaml";

export type CaptureMode = "compare" | "record" | "off";
export type Stack = { helper: string; origin: string };

export type PlannedRun = {
  name: string;
  setup: string[][];
  captures: { mode: CaptureMode; missing: string[]; dir: string };
  /** Maestro's command that prepares the app for the run's Candidate `email`, its output in `out`/prepare. */
  prepare: (email: string, out: string) => string[];
  /** The command whose output is the device's own log of the run (the app's, and the system's around it). */
  logs: string[];
  /** Maestro's command that runs the run's flows, its report and output in `out`. */
  flows: (email: string, out: string) => string[];
};

export function planRuns(
  hardware: HardwareId,
  { root, stack, captures, referenceExists }: { root: string; stack: Stack; captures: CaptureMode; referenceExists: (path: string) => boolean },
): PlannedRun[] {
  const port = new URL(stack.origin).port;
  return runsOn(hardware).map((run) => {
    const captureDir = join(root, "captures", run.env.CAPTURE_DIR!);
    const missing = captures === "compare" ? KEY_SCREENS.map((screen) => join(captureDir, `${screen}.png`)).filter((path) => !referenceExists(path)) : [];
    const mode: CaptureMode = missing.length > 0 ? "record" : captures;
    const env = (email: string) =>
      Object.entries({ ...run.env, STACK_URL: stack.helper, STACK_EMAIL: email, CAPTURES: mode }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    return {
      name: `${run.device.id}-${run.theme}${run.textSize === "largest" ? "-largest-text" : ""}`,
      // The emulator's own localhost is not the machine's: the stack's port is forwarded to it.
      setup: [...(run.platform === "android" ? [["adb", "reverse", `tcp:${port}`, `tcp:${port}`], ["adb", "logcat", "-c"]] : []), ...run.setup],
      logs:
        run.platform === "android"
          ? ["adb", "logcat", "-d"]
          : ["xcrun", "simctl", "spawn", "booted", "log", "show", "--last", "30m", "--style", "compact", "--predicate", 'process == "Jobbbox"'],
      captures: { mode, missing, dir: run.env.CAPTURE_DIR! },
      prepare: (email, out) => ["maestro", "test", join(root, "subflows", "prepare.yaml"), `--test-output-dir=${join(out, "prepare")}`, ...env(email)],
      flows: (email, out) => [
        "maestro",
        "test",
        // The key screens alone: their flow, since the workspace's order names flows the tag leaves out.
        ...(run.tags.includes("flow") ? [root, `--include-tags=${run.tags.join(",")}`] : [join(root, KEY_SCREENS_FLOW)]),
        "--format=junit",
        `--output=${join(out, "report.xml")}`,
        `--test-output-dir=${out}`,
        ...env(email),
      ],
    };
  });
}

/**
 * The key screens a `record` run took, from Maestro's output `out` (its own folders, then record/<capture dir>/), as
 * `[taken, reference]` paths: the reference beside the flows, captures/<capture dir>/<screen>.png.
 */
export function recordedCaptures(files: string[], root: string, captureDir: string): [string, string][] {
  return KEY_SCREENS.flatMap((screen) => {
    const taken = files.filter((file) => file.endsWith(`/record/${captureDir}/${screen}.png`)).sort().at(-1);
    return taken ? [[taken, join(root, "captures", captureDir, `${screen}.png`)] as [string, string]] : [];
  });
}

/** `attempt`, tried again after `waitSeconds` while it fails, `tries` times at most. For a device's set-up, never for a flow. */
export function settled(
  attempt: () => boolean,
  { tries = 3, waitSeconds = 10, pause = (seconds) => void spawnSync("sleep", [String(seconds)]) }: { tries?: number; waitSeconds?: number; pause?: (seconds: number) => unknown } = {},
): boolean {
  for (let n = 1; n <= tries; n++) {
    if (attempt()) return true;
    if (n < tries) pause(waitSeconds);
  }
  return false;
}

function main(argv: string[]) {
  const [hardware, ...rest] = argv;
  const option = (name: string, fallback?: string) => {
    const index = rest.indexOf(`--${name}`);
    return index >= 0 ? rest[index + 1] : fallback;
  };
  if (!hardware || !(hardware in CI_HARDWARE)) throw new Error(`usage: run.ts <${Object.keys(CI_HARDWARE).join("|")}> --stack <ready.json>`);
  const stack = JSON.parse(readFileSync(option("stack")!, "utf8")) as Stack;
  const out = option("out", join(__dirname, "results"))!;
  const runs = planRuns(hardware as HardwareId, { root: __dirname, stack, captures: option("captures", "compare") as CaptureMode, referenceExists: existsSync });
  // Maestro's own analytics stay off: nothing of a run leaves the CI machine but its artifacts, of invented data only.
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true" };
  const exec = (command: string[], cwd?: string) => spawnSync(command[0]!, command.slice(1), { stdio: "inherit", env, cwd }).status === 0;

  if (!bootSetup(hardware as HardwareId).every((command) => exec(command))) throw new Error(`${hardware} could not be set to French`);
  const results: { name: string; ok: boolean; missing: string[] }[] = [];
  for (const run of runs) {
    console.log(`\n=== ${run.name} (captures: ${run.captures.mode})`);
    const dir = join(out, run.name);
    mkdirSync(dir, { recursive: true });
    // Set-up, not a check: tried again should the device not take it yet (an emulator's services, seconds after its
    // framework restarted: « Can't find service: uimode », run 42666513659).
    const setUp = settled(() => run.setup.every((command) => exec(command)));
    const seeded = spawnSync("curl", ["--fail", "--silent", "--show-error", "-X", "POST", `${stack.helper}/candidates`], { encoding: "utf8" });
    const email = seeded.status === 0 ? (JSON.parse(seeded.stdout) as { email: string }).email : null;
    // Maestro writes a screenshot it takes under its working directory when it makes no bundle: the run's own.
    // The app's preparation (cleared, oriented) is set-up, not a check: tried a second time should
    // Maestro's driver give up on it (an iPhone SE's « Set orientation » hung until Maestro quit, run 42323647801).
    // iOS first stops that simulator's orphaned XCTest process and restores its settings after rebooting it.
    const prepared = () => exec(run.prepare(email!, dir), dir);
    const prepare = () => CI_HARDWARE[hardware as HardwareId].platform === "ios"
      ? prepareIOSRun(prepared, () => run.setup.every((command) => exec(command)))
      : prepared() || prepared();
    const ok = setUp && email !== null && prepare() && exec(run.flows(email, dir), dir);
    writeFileSync(join(dir, "device.log"), spawnSync(run.logs[0]!, run.logs.slice(1), { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).stdout ?? "");
    if (run.captures.mode === "record") {
      const files = (readdirSync(dir, { recursive: true }) as string[]).map((file) => join(dir, file));
      for (const [taken, reference] of recordedCaptures(files, __dirname, run.captures.dir)) {
        mkdirSync(dirname(reference), { recursive: true });
        copyFileSync(taken, reference);
      }
    }
    results.push({ name: run.name, ok: ok && run.captures.missing.length === 0, missing: run.captures.missing });
  }

  const summary = [
    `## Maestro, ${hardware}`,
    "",
    ...results.map(({ name, ok, missing }) => `- ${ok ? "✅" : "❌"} ${name}${missing.length ? ` : ${missing.length} capture(s) de référence manquante(s), dessinée(s) dans l'artefact` : ""}`),
  ].join("\n");
  console.log(`\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}

if (require.main === module) main(process.argv.slice(2));
