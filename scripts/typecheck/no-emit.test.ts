import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// `npm run typecheck` runs `tsc -p` in every workspace. A tsconfig whose `extends` lives in
// node_modules (expo/tsconfig.base) or in a generated folder (.wxt) loses that base when it is
// not there yet, for instance in a fresh worktree whose `npm install` has not finished: tsc then
// reports TS6053 but still compiles, and writes a .js next to every .ts. Those strays are then
// linted as plain scripts (`'expect' is not defined`, thousands of errors under apps/mobile).
// So a workspace may only inherit `noEmit` from a base that is committed to this repository.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n"));
const tsconfigs = [...tracked].filter((file) => /(^|\/)tsconfig\.json$/.test(file) && /^(apps|packages)\//.test(file));

function readConfig(file: string): { extends?: string; compilerOptions?: { noEmit?: boolean } } {
  const { config, error } = ts.readConfigFile(join(root, file), (path) => readFileSync(path, "utf8"));
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  return config;
}

/** Whether tsc can never emit with this config, whatever is installed or generated. */
function neverEmits(file: string): boolean {
  const config = readConfig(file);
  if (config.compilerOptions?.noEmit !== undefined) return config.compilerOptions.noEmit === true;
  if (!config.extends || !config.extends.startsWith(".")) return false;
  const base = relative(root, resolve(root, dirname(file), config.extends));
  return tracked.has(base) && neverEmits(base);
}

describe("workspace typecheck", () => {
  it("finds the workspace tsconfigs", () => {
    expect(tsconfigs).toContain("apps/mobile/tsconfig.json");
  });

  it.each(tsconfigs)("%s never writes .js files, even before its base config is installed", (file) => {
    expect(neverEmits(file)).toBe(true);
  });
});
