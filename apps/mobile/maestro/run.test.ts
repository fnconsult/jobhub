import { join } from "node:path";
import { planRuns, recordedCaptures, settled } from "./run";

const ROOT = "/repo/apps/mobile/maestro";
const STACK = { helper: "http://127.0.0.1:4705", origin: "http://localhost:3705" };
const missing = () => false;
/** The `-e KEY=value` pairs of a Maestro command. */
const envOf = (command: string[]) => Object.fromEntries(command.flatMap((arg, index) => (command[index - 1] === "-e" ? [arg.split(/=(.*)/s).slice(0, 2)] : [])));
const present = () => true;

describe("the Maestro runs of one CI job (#705)", () => {
  it("sets the device up, then prepares the app, then runs the run's flows with its env, the run's Candidate signed in by its code", () => {
    const [first] = planRuns("iphone-se", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(first!.name).toBe("iphone-se-light");
    expect(first!.setup[0]).toEqual(["xcrun", "simctl", "ui", "booted", "appearance", "light"]);
    const env = { STACK_URL: "http://127.0.0.1:4705", STACK_EMAIL: "maestro.1@e2e.jobbbox.test", CAPTURES: "compare", CAPTURE_DIR: "iphone-se/light" };
    const prepare = first!.prepare("maestro.1@e2e.jobbbox.test", "/out/iphone-se-light");
    expect(prepare.slice(0, 3)).toEqual(["maestro", "test", join(ROOT, "subflows", "prepare.yaml")]);
    expect(envOf(prepare)).toMatchObject({ ...env, DEVICE: "iphone-se", ORIENTATION: "PORTRAIT" });
    const flows = first!.flows("maestro.1@e2e.jobbbox.test", "/out/iphone-se-light");
    expect(flows.slice(0, 3)).toEqual(["maestro", "test", ROOT]);
    expect(flows).toEqual(expect.arrayContaining(["--include-tags=flow,key-screens", "--format=junit", "--output=/out/iphone-se-light/report.xml", "--test-output-dir=/out/iphone-se-light"]));
    expect(envOf(flows)).toMatchObject({ ...env, DEVICE: "iphone-se", LAYOUT: "fullPage", THEME: "light" });
  });

  it("runs the key screens' flow alone in the dark theme and at the largest text size", () => {
    const [, dark, largest] = planRuns("iphone-se", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    for (const run of [dark!, largest!]) expect(run.flows("someone@e2e.jobbbox.test", "/out").slice(0, 3)).toEqual(["maestro", "test", `${ROOT}/flows/2-ecrans-cles.yaml`]);
  });

  it("runs on Android with the stack's web port reached from the emulator as on the machine", () => {
    const runs = planRuns("android-foldable", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(runs.map((run) => run.name)).toEqual([
      "foldable-unfolded-light",
      "foldable-unfolded-dark",
      "foldable-unfolded-light-largest-text",
      "foldable-folded-light",
      "foldable-folded-dark",
      "foldable-folded-light-largest-text",
    ]);
    expect(runs[0]!.setup[0]).toEqual(["adb", "reverse", "tcp:3705", "tcp:3705"]);
    expect(runs[0]!.setup).toContainEqual(["adb", "emu", "unfold"]);
  });

  it("keeps the device's own log of each run beside Maestro's, the app's process on iOS, the emulator's logcat cleared before", () => {
    const [ios] = planRuns("ipad", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(ios!.logs).toEqual(["xcrun", "simctl", "spawn", "booted", "log", "show", "--last", "30m", "--style", "compact", "--predicate", 'process == "Jobbbox"']);
    const [android] = planRuns("android-tablet", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(android!.setup).toContainEqual(["adb", "logcat", "-c"]);
    expect(android!.logs).toEqual(["adb", "logcat", "-d"]);
    expect(ios!.prepare("someone@e2e.jobbbox.test", "/out/ipad-landscape-light")).toContain("--test-output-dir=/out/ipad-landscape-light/prepare");
  });

  it("compares the key screens with their references when they exist", () => {
    const [first] = planRuns("ipad", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(first!.captures).toEqual({ mode: "compare", missing: [], dir: "ipad-landscape/light" });
  });

  it("draws a run's missing references, and says which, so the run fails as a missing web baseline does", () => {
    const [first] = planRuns("ipad", { root: ROOT, stack: STACK, captures: "compare", referenceExists: (path) => !path.endsWith("agenda.png") });
    expect(first!.captures).toEqual({ mode: "record", missing: [`${ROOT}/captures/ipad-landscape/light/agenda.png`], dir: "ipad-landscape/light" });
    expect(envOf(first!.prepare("someone@e2e.jobbbox.test", "/out")).CAPTURES).toBe("record");
  });

  it("draws every reference again on purpose (`record`), and skips them (`off`)", () => {
    expect(planRuns("ipad", { root: ROOT, stack: STACK, captures: "record", referenceExists: present })[0]!.captures).toMatchObject({ mode: "record", missing: [] });
    expect(planRuns("ipad", { root: ROOT, stack: STACK, captures: "off", referenceExists: missing })[0]!.captures).toMatchObject({ mode: "off", missing: [] });
  });

  it("takes the screenshots a `record` run took from Maestro's output to the references beside the flows", () => {
    const out = "/out/ipad-landscape-dark";
    expect(
      recordedCaptures(
        [`${out}/report.xml`, `${out}/2026-11-06_101112/takeScreenshot/record/ipad-landscape/dark/accueil.png`, `${out}/record/ipad-landscape/dark/agenda.png`, `${out}/record/ipad-portrait/dark/agenda.png`],
        ROOT,
        "ipad-landscape/dark",
      ),
    ).toEqual([
      [`${out}/2026-11-06_101112/takeScreenshot/record/ipad-landscape/dark/accueil.png`, `${ROOT}/captures/ipad-landscape/dark/accueil.png`],
      [`${out}/record/ipad-landscape/dark/agenda.png`, `${ROOT}/captures/ipad-landscape/dark/agenda.png`],
    ]);
  });
});

describe("a device's set-up, tried again while the device does not take it", () => {
  it("is tried again after a wait, a bounded number of times", () => {
    const waits: number[] = [];
    const answers = [false, false, true];
    expect(settled(() => answers.shift()!, { pause: (seconds) => waits.push(seconds) })).toBe(true);
    expect(waits).toEqual([10, 10]);
  });

  it("fails once its tries are spent, without a last wait", () => {
    const waits: number[] = [];
    let tried = 0;
    expect(settled(() => (tried++, false), { tries: 3, pause: (seconds) => waits.push(seconds) })).toBe(false);
    expect(tried).toBe(3);
    expect(waits).toHaveLength(2);
  });
});
