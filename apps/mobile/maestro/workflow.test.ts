// The CI job of the Maestro flows (#705): .github/workflows/mobile-e2e.yml, checked against the devices it must boot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { CI_HARDWARE, SIMULATOR } from "./devices";

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { "runs-on": string; needs?: string | string[]; env?: Record<string, string>; strategy?: { matrix: { include: Record<string, string>[] } }; steps: Step[] };
const workflow = load(readFileSync(join(__dirname, "..", "..", "..", ".github", "workflows", "mobile-e2e.yml"), "utf8")) as {
  on: Record<string, { paths?: string[]; branches?: string[]; inputs?: Record<string, { options?: string[]; default?: string }> }>;
  env: Record<string, string>;
  jobs: Record<string, Job>;
};
const steps = (job: string) => workflow.jobs[job]!.steps;
const runs = (job: string) => steps(job).map((step) => step.run ?? "").join("\n");

describe("the mobile-e2e workflow (#705)", () => {
  it("runs on a pull request, and on main, when the app or the shared package changes", () => {
    for (const event of ["pull_request", "push"] as const) {
      expect(workflow.on[event]!.paths).toEqual(expect.arrayContaining(["apps/mobile/**", "packages/shared/**"]));
    }
    expect(workflow.on.push!.branches).toEqual(["main"]);
  });

  it("is run by hand to draw the reference captures again", () => {
    expect(workflow.on.workflow_dispatch!.inputs!.captures).toMatchObject({ options: ["compare", "record"], default: "compare" });
  });

  it("builds the app once per platform, for the seeded stack on the CI machine", () => {
    for (const job of ["build-ios", "build-android"]) {
      const build = steps(job).find((step) => step.env?.JOBHUB_E2E_BUILD === "1");
      expect(build?.env?.EXPO_PUBLIC_WEB_APP_URL).toBe("http://localhost:${{ env.E2E_WEB_PORT }}");
    }
    expect(workflow.env.E2E_WEB_PORT).toMatch(/^\d+$/);
    expect(runs("build-ios")).toContain("-sdk iphonesimulator");
    expect(runs("build-android")).toContain("assembleRelease");
  });

  it("boots each device of apps/mobile/maestro/devices.ts in its own job, after its platform's build", () => {
    const booted = (job: string) => workflow.jobs[job]!.strategy!.matrix.include.map(({ hardware, model }) => ({ hardware, model }));
    const expected = (platform: string) => Object.values(CI_HARDWARE).filter((each) => each.platform === platform).map(({ id, model }) => ({ hardware: id, model }));
    expect(booted("maestro-ios")).toEqual(expected("ios"));
    expect(booted("maestro-android")).toEqual(expected("android"));
    expect(workflow.jobs["maestro-ios"]!.needs).toBe("build-ios");
    expect(workflow.jobs["maestro-android"]!.needs).toBe("build-android");
  });

  it("creates the iOS simulator under the name run.ts sets up", () => {
    expect(runs("maestro-ios")).toContain(`xcrun simctl create ${SIMULATOR} "\${{ matrix.model }}"`);
  });

  it("runs the flows by run.ts against the held stack, Maestro at a pinned version, its analytics off", () => {
    expect(workflow.env.MAESTRO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(workflow.env.MAESTRO_CLI_NO_ANALYTICS).toBe("1");
    for (const job of ["maestro-ios", "maestro-android"]) {
      const all = JSON.stringify(steps(job));
      expect(all).toContain("apps/mobile/maestro/start-stack.sh");
      expect(all).toContain("npx tsx apps/mobile/maestro/run.ts ${{ matrix.hardware }}");
      expect(all).toContain("--captures ${{ inputs.captures || 'compare' }}");
    }
  });

  it("keeps each job's results and the captures it drew", () => {
    for (const job of ["maestro-ios", "maestro-android"]) {
      const uploads = steps(job).filter((step) => step.uses?.startsWith("actions/upload-artifact@"));
      expect(uploads.map((step) => step.with?.name)).toEqual(["maestro-results-${{ matrix.hardware }}", "maestro-captures-${{ matrix.hardware }}"]);
      expect(uploads.every((step) => (step as { if?: string }).if === "always()")).toBe(true);
    }
  });
});
