import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { productionRefProblems } from "./check-production-ref.mjs";

describe("productionRefProblems — Production runs only a Promoted Version (#560)", () => {
  it("refuses main, any branch, and a tag that is not a Version", () => {
    for (const ref of ["refs/heads/main", "refs/heads/issue-560-promotion-prod", "refs/heads/prod", "refs/tags/v1.2", "refs/tags/v1.2.3-beta.1", "", undefined])
      expect(productionRefProblems({ ref, compare: "identical", version: "1.2.3" })[0]).toMatch(/Production deploys only a Version's tag vX\.Y\.Z/);
  });

  it("refuses a tag that is not on prod, or when there is no prod", () => {
    expect(productionRefProblems({ ref: "refs/tags/v1.2.3", compare: "behind", version: "1.2.3" })).toEqual([expect.stringMatching(/Tag v1\.2\.3 is not on prod \(behind\)/)]);
    expect(productionRefProblems({ ref: "refs/tags/v1.2.3", compare: "diverged", version: "1.2.3" })).toHaveLength(1);
    expect(productionRefProblems({ ref: "refs/tags/v1.2.3", compare: null, version: "1.2.3" })).toEqual([expect.stringMatching(/There is no prod branch/)]);
  });

  it("refuses a tag whose package.json carries another Version", () => {
    expect(productionRefProblems({ ref: "refs/tags/v1.2.3", compare: "identical", version: "1.2.4" })).toEqual([expect.stringMatching(/carries the Version 1\.2\.4, not 1\.2\.3/)]);
  });

  it("lets through the tag prod points at, and an earlier one to roll back", () => {
    expect(productionRefProblems({ ref: "refs/tags/v1.2.3", compare: "identical", version: "1.2.3" })).toEqual([]);
    expect(productionRefProblems({ ref: "refs/tags/v1.2.2", compare: "ahead", version: "1.2.2" })).toEqual([]);
  });

  it("as deploy.yml runs it: fails with a workflow error from main", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "production-ref-"));
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version: "1.2.3" }));
    const script = path.resolve("scripts/deploy/check-production-ref.mjs");
    const run = (env: Record<string, string>) => {
      try {
        return { code: 0, out: execFileSync("node", [script], { cwd, env: { ...process.env, ...env }, encoding: "utf8" }) };
      } catch (error) {
        return { code: (error as { status: number }).status, out: (error as { stdout: string }).stdout };
      }
    };
    expect(run({ GITHUB_REF: "refs/heads/main", PROD_COMPARE: "identical" })).toEqual({ code: 1, out: expect.stringMatching(/^::error::Production deploys only/) });
    expect(run({ GITHUB_REF: "refs/tags/v1.2.3", PROD_COMPARE: "identical" })).toEqual({ code: 0, out: "✓ refs/tags/v1.2.3 is a Version on prod\n" });
  });
});

describe("deploy.yml", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");

  it("checks the ref before anything else of a Production deploy", () => {
    const check = workflow.slice(workflow.indexOf("  check:"), workflow.indexOf("  images:"));
    expect(check).toMatch(/if: inputs\.target == 'production'[\s\S]*compare\/\$GITHUB_SHA\.\.\.prod[\s\S]*node scripts\/deploy\/check-production-ref\.mjs/);
    expect(check.indexOf("check-production-ref.mjs")).toBeLessThan(check.indexOf("Check confirmation, configuration and CI"));
    expect(workflow).toMatch(/images:\n {4}needs: check/);
  });

  // Staging may deploy a commit of main other than the ref's head (`-f sha=…`, `-f sha=latest-green`).
  it("refuses sha with Production, and checks that a staging sha is on main and green", () => {
    const check = workflow.slice(workflow.indexOf("  check:"), workflow.indexOf("  images:"));
    expect(workflow).toMatch(/\n {6}sha:\n {8}description: "Staging only: [^\n]*\n {8}type: string\n {8}default: ""\n/);
    expect(check).toMatch(/elif \[ "\$TARGET" = production \]; then\n\s+echo "::error::'sha' is for staging only/);
    expect(check).toMatch(/compare\/\$sha\.\.\.main[\s\S]*identical \| ahead\) ;;/);
    expect(check).toMatch(/--workflow ci\.yml --commit "\$SHA"/);
    expect(check).toContain("sha: ${{ steps.commit.outputs.sha }}");
  });

  it("builds, tags, bakes in, checks out and records the resolved commit, never the ref's head", () => {
    const after = workflow.slice(workflow.indexOf("  images:"));
    expect(after).not.toContain("github.sha");
    expect(after).toContain("ref: ${{ needs.check.outputs.sha }}");
    expect(after).toContain("tags: ${{ env.IMAGES }}/${{ matrix.name }}:${{ needs.check.outputs.sha }}");
    expect(after).toContain("JOBHUB_COMMIT=${{ needs.check.outputs.sha }}");
    expect(after).toContain("JOBHUB_REVISION: ${{ needs.check.outputs.sha }}");
    // GitHub's own Deployment record would name github.sha: every environment opts out, and deploy writes its own.
    expect(workflow.match(/environment:\n {6}name: \$\{\{ inputs\.target \}\}\n {6}deployment: false\n/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/environment: \$\{\{/);
    expect(after).toMatch(/jq -n --arg sha "\$SHA"[\s\S]*ref: \$sha[\s\S]*repos\/\$GITHUB_REPOSITORY\/deployments" --input -/);
  });
});
