import { join } from "node:path";
import { planRuns } from "./run";

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
    const env = { STACK_URL: "http://127.0.0.1:4705", STACK_EMAIL: "maestro.1@e2e.jobbbox.test", CAPTURES: "compare", CAPTURE_DIR: `${ROOT}/captures/iphone-se/light` };
    const prepare = first!.prepare("maestro.1@e2e.jobbbox.test");
    expect(prepare.slice(0, 3)).toEqual(["maestro", "test", join(ROOT, "subflows", "prepare.yaml")]);
    expect(envOf(prepare)).toMatchObject({ ...env, DEVICE: "iphone-se", ORIENTATION: "PORTRAIT" });
    const flows = first!.flows("maestro.1@e2e.jobbbox.test", "/out/iphone-se-light");
    expect(flows.slice(0, 3)).toEqual(["maestro", "test", ROOT]);
    expect(flows).toEqual(expect.arrayContaining(["--include-tags=flow,key-screens", "--format=junit", "--output=/out/iphone-se-light/report.xml", "--test-output-dir=/out/iphone-se-light"]));
    expect(envOf(flows)).toMatchObject({ ...env, DEVICE: "iphone-se", LAYOUT: "fullPage", THEME: "light" });
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

  it("compares the key screens with their references when they exist", () => {
    const [first] = planRuns("ipad", { root: ROOT, stack: STACK, captures: "compare", referenceExists: present });
    expect(first!.captures).toEqual({ mode: "compare", missing: [] });
  });

  it("draws a run's missing references, and says which, so the run fails as a missing web baseline does", () => {
    const [first] = planRuns("ipad", { root: ROOT, stack: STACK, captures: "compare", referenceExists: (path) => !path.endsWith("agenda.png") });
    expect(first!.captures).toEqual({ mode: "record", missing: [`${ROOT}/captures/ipad-landscape/light/agenda.png`] });
    expect(envOf(first!.prepare("someone@e2e.jobbbox.test")).CAPTURES).toBe("record");
  });

  it("draws every reference again on purpose (`record`), and skips them (`off`)", () => {
    expect(planRuns("ipad", { root: ROOT, stack: STACK, captures: "record", referenceExists: present })[0]!.captures).toEqual({ mode: "record", missing: [] });
    expect(planRuns("ipad", { root: ROOT, stack: STACK, captures: "off", referenceExists: missing })[0]!.captures).toEqual({ mode: "off", missing: [] });
  });
});
