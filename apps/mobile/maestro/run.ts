/**
 * Runs the app's Maestro flows on the simulator or emulator a CI job booted (#705, docs/ops/mobile.md), against the
 * seeded test stack (e2e/mobile-stack.spec.ts), each run of `runsOn(hardware)` in turn:
 *
 *   npx tsx apps/mobile/maestro/run.ts <hardware> --stack <ready.json> [--captures compare|record|off] [--out <dir>]
 *
 * The hardware first set to French, then for each run: the device set up (theme, text size, fold, status bar), a new seeded Candidate, the app prepared
 * (cleared, oriented, in Split View), then the run's flows. A run with missing reference captures draws them and
 * fails, as a missing web baseline does; `record` draws them all again, on purpose. Each run's JUnit report, screenshots
 * and Maestro's logs go to `<out>/<run>`; the captures to apps/mobile/maestro/captures.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bootSetup, CI_HARDWARE, runsOn, type HardwareId } from "./devices";
import { KEY_SCREENS } from "./seed";

export type CaptureMode = "compare" | "record" | "off";
export type Stack = { helper: string; origin: string };

export type PlannedRun = {
  name: string;
  setup: string[][];
  captures: { mode: CaptureMode; missing: string[] };
  /** Maestro's command that prepares the app for the run's Candidate `email`. */
  prepare: (email: string) => string[];
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
      Object.entries({ ...run.env, STACK_URL: stack.helper, STACK_EMAIL: email, CAPTURES: mode, CAPTURE_DIR: captureDir }).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    return {
      name: `${run.device.id}-${run.theme}${run.textSize === "largest" ? "-largest-text" : ""}`,
      // The emulator's own localhost is not the machine's: the stack's port is forwarded to it.
      setup: [...(run.platform === "android" ? [["adb", "reverse", `tcp:${port}`, `tcp:${port}`]] : []), ...run.setup],
      captures: { mode, missing },
      prepare: (email) => ["maestro", "test", join(root, "subflows", "prepare.yaml"), ...env(email)],
      flows: (email, out) => [
        "maestro",
        "test",
        root,
        `--include-tags=${run.tags.join(",")}`,
        "--format=junit",
        `--output=${join(out, "report.xml")}`,
        `--test-output-dir=${out}`,
        ...env(email),
      ],
    };
  });
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
  // Maestro's own analytics stay off: nothing of the run leaves the CI machine (docs/privacy/register.md).
  const env = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: "1", MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true" };
  const exec = (command: string[]) => spawnSync(command[0]!, command.slice(1), { stdio: "inherit", env }).status === 0;

  if (!bootSetup(hardware as HardwareId).every(exec)) throw new Error(`${hardware} could not be set to French`);
  const results: { name: string; ok: boolean; missing: string[] }[] = [];
  for (const run of runs) {
    console.log(`\n=== ${run.name} (captures: ${run.captures.mode})`);
    const dir = join(out, run.name);
    mkdirSync(dir, { recursive: true });
    const setUp = run.setup.every(exec);
    const seeded = spawnSync("curl", ["--fail", "--silent", "--show-error", "-X", "POST", `${stack.helper}/candidates`], { encoding: "utf8" });
    const email = seeded.status === 0 ? (JSON.parse(seeded.stdout) as { email: string }).email : null;
    const ok = setUp && email !== null && exec(run.prepare(email)) && exec(run.flows(email, dir));
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
