import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

describe("@jobhub/help calls no AI model (ADR-0035)", () => {
  it("has no dependency on @jobhub/ai", () => {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as Record<string, unknown>;
    const dependencies = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) =>
      Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}),
    );
    expect(dependencies).not.toContain("@jobhub/ai");
  });

  it("imports nothing from @jobhub/ai", () => {
    const sources = readdirSync(path.join(packageDir, "src"), { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    const importingAi = sources.filter((file) => /from\s+["']@jobhub\/ai/.test(readFileSync(path.join(packageDir, "src", file), "utf8")));
    expect(importingAi).toEqual([]);
  });
});
