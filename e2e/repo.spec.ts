import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import config from "../playwright.config";

const read = (file: string) => readFileSync(file, "utf8");

test.describe("monorepo tooling", () => {
  test("is an npm-workspaces monorepo with web, extension and shared packages", () => {
    const root = JSON.parse(read("package.json"));
    expect(root.workspaces).toEqual(expect.arrayContaining(["apps/*", "packages/*"]));
    const names = ["apps/web", "apps/extension", "packages/shared"].map((dir) => JSON.parse(read(`${dir}/package.json`)).name);
    expect(names).toEqual(["@jobhub/web", "@jobhub/extension", "@jobhub/shared"]);
    for (const app of ["apps/web", "apps/extension"]) {
      expect(JSON.parse(read(`${app}/package.json`)).dependencies).toHaveProperty("@jobhub/shared");
    }
  });

  test("CI runs lint, typecheck, tests and the e2e suite", () => {
    const ci = read(".github/workflows/ci.yml");
    for (const step of ["npm run lint", "npm run typecheck", "npm test", "npm run build", "npm run test:e2e"]) {
      expect(ci).toContain(`run: ${step}`);
    }
    expect(ci).toMatch(/pull_request/);
  });

  // Issue #133 (ADR-0018): complex widgets sit on unstyled Radix primitives, styled with our tokens.
  test("complex widgets use unstyled Radix primitives, with no Tailwind or shadcn (ADR-0018)", () => {
    const adr = read("docs/adr/0018-radix-primitives-for-complex-widgets-only.md");
    expect(adr).toMatch(/unstyled Radix/i);
    expect(adr).toMatch(/Tailwind/);
    expect(adr).toMatch(/shadcn/);
    expect(adr).toMatch(/ADR-0009/);

    const web = JSON.parse(read("apps/web/package.json"));
    const deps = { ...web.dependencies, ...web.devDependencies };
    expect(deps).toHaveProperty(["@radix-ui/react-dropdown-menu"]);
    // The sidebar's drawer below 64rem (#134) is a Radix dialog.
    expect(deps).toHaveProperty(["@radix-ui/react-dialog"]);
    expect(Object.keys(deps).filter((n) => /tailwind|shadcn/i.test(n))).toEqual([]);

    // The Profile switcher now sits in the sidebar layout (#134), which replaced the workspace header.
    expect(read("apps/web/src/components/SidebarLayout.tsx")).not.toContain("<details");
    // Its drawer lives in the shell the Candidate's and the Back Office's sidebars share (#204), and that
    // drawer is the design system's Drawer (#462), a Radix dialog.
    expect(read("apps/web/src/components/SidebarShell.tsx")).toContain('from "@/design/Drawer"');
    expect(read("apps/web/src/design/Drawer.tsx")).toContain("@radix-ui/react-dialog");
  });

  test("lint rejects a hard-coded user-facing string in the web app", () => {
    const dir = mkdtempSync(path.join("apps/web/src", "e2e-lint-"));
    try {
      const file = path.join(dir, "Hardcoded.tsx");
      writeFileSync(file, "export function Hardcoded() {\n  return <p>Bonjour tout le monde</p>;\n}\n");
      const result = spawnSync("npx", ["eslint", file], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("i18next/no-literal-string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lint rejects a hard-coded user-facing string in the extension", () => {
    const dir = mkdtempSync(path.join("apps/extension/entrypoints", "e2e-lint-"));
    try {
      const file = path.join(dir, "Hardcoded.tsx");
      writeFileSync(file, "export function Hardcoded() {\n  return <p>Bonjour</p>;\n}\n");
      const result = spawnSync("npx", ["eslint", file], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("i18next/no-literal-string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Next.js runs one `next dev` per app directory and refuses a second ("Another next dev
  // server is already running"), so the specs that start it must never run at the same time:
  // all in one project, one spec at a time. Two projects run in parallel with each other (#71).
  test("the e2e specs that start `npm run dev` share one serial project", () => {
    const startsNextDev = readdirSync("e2e")
      .filter((file) => file.endsWith(".spec.ts"))
      .filter((file) => /\[\s*(?:"npm",\s*)?"run",\s*"dev"\s*\]/.test(read(path.join("e2e", file))));
    expect(startsNextDev.length).toBeGreaterThan(1);

    const projects = (config.projects ?? []).filter((project) =>
      startsNextDev.some((file) => (project.testMatch as RegExp).test(file)),
    );
    expect(projects.map((project) => project.name)).toHaveLength(1);
    for (const file of startsNextDev) expect(file).toMatch(projects[0].testMatch as RegExp);
    expect(projects[0].workers).toBe(1);
  });

  // `npm run build -w @jobhub/help` reads every Markdown file of packages/help and rewrites its generated modules. The
  // specs that run it also change those files for a while (the Legal Text fixtures of #546, a Help Article hidden by
  // #347's), so one spec's build fails on the other's files if they overlap: all in one project, one spec at a time.
  test("the e2e specs that rebuild @jobhub/help share one serial project", () => {
    const rebuildsHelp = readdirSync("e2e")
      .filter((file) => file.endsWith(".spec.ts"))
      .filter((file) => /"run",\s*"build",\s*"-w",\s*"@jobhub\/help"/.test(read(path.join("e2e", file))));
    expect(rebuildsHelp.length).toBeGreaterThan(1);

    const projects = (config.projects ?? []).filter((project) =>
      rebuildsHelp.some((file) => (project.testMatch as RegExp).test(file)),
    );
    expect(projects.map((project) => project.name)).toHaveLength(1);
    for (const file of rebuildsHelp) expect(file).toMatch(projects[0].testMatch as RegExp);
    expect(projects[0].workers).toBe(1);
  });

  test("EU hosting target is documented (ADR-0007)", () => {
    const adr = read("docs/adr/0007-eu-hosting-provider-agnostic-ai.md");
    expect(adr).toMatch(/\bEU\b/);
    const hosting = read("docs/ops/hosting.md");
    expect(hosting).toContain("ADR-0007");
    expect(hosting).toMatch(/eu-west-3|eu-central-1|fr-par/);
    expect(hosting).not.toMatch(/\b(us|ap|sa)-(east|west|south|north|central|northeast|southeast)-\d\b/);
    expect(read("README.md")).toMatch(/hosting\.md|ADR-0007/);
  });
});

// Issue #121: the identity routing rule is a decision on record.
test.describe("ADR-0007 amendment: identity routing (issue #121)", () => {
  test("is committed, with the consent, the Mistral route, the declared identity and the safety net", () => {
    const adr = read(readdirSync("docs/adr").filter((f) => f.startsWith("0007")).map((f) => `docs/adr/${f}`)[0]!);
    const section = /## Amendment: [^\n]*(identity|EU AI consent)[^\n]*\n([\s\S]*?)(?=\n## |$)/i.exec(adr);
    expect(section, "an amendment about identity routing").not.toBeNull();
    const text = section![2]!;
    expect(text).toMatch(/EU AI consent/);
    expect(text).toMatch(/Mistral/);
    expect(text).toMatch(/containsIdentity/);
    expect(text).toMatch(/phone/i);
    expect(text).toMatch(/email/i);
    expect(text).toMatch(/log/i);
  });
});

// Issue #236: Sectors, Subsectors and Domains are Search Criteria, named in the glossary and on record in ADR-0025.
test.describe("Search Criteria's Sectors, Subsectors and Domains are documented (issue #236)", () => {
  const entry = (glossary: string, term: string) => new RegExp(`^\\*\\*${term}\\*\\*:\\n([^\\n]+)`, "m").exec(glossary)?.[1];

  test("the glossary defines them and the Reference data, and Search Criteria lists them", () => {
    const glossary = read("CONTEXT.md");
    expect(entry(glossary, "Search Criteria"), "the Search Criteria entry").toMatch(/Sectors, Subsectors and Domains/);
    expect(entry(glossary, "Sector"), "a Sector entry").toMatch(/NAF rév\. 2/);
    expect(entry(glossary, "Subsector"), "a Subsector entry").toMatch(/division/);
    expect(entry(glossary, "Domain"), "a Domain entry").toMatch(/ROME 4\.0 professional domain/);
    const reference = entry(glossary, "Reference data");
    expect(reference, "a Reference data entry").toMatch(/INSEE/);
    expect(reference).toMatch(/France Travail/);
    expect(reference).toMatch(/monthly/);
  });

  test("ADR-0025 has an addendum for them", () => {
    const adr = read("docs/adr/0025-search-criteria-take-several-values-one-is-enough.md");
    const addendum = /^Addendum \(#236\): (.+)$/m.exec(adr)?.[1];
    expect(addendum, "an addendum (#236)").toBeDefined();
    for (const term of ["Sectors", "Subsectors", "Domains", "NAF rév. 2", "ROME 4.0", "secteurActivite", "domaine", "Match Score", "ADR-0007"]) {
      expect(addendum).toContain(term);
    }
  });
});

// Issue #375: the Signalement icon in the Sidebar is an icon alone, an exception to ADR-0009's floor on record.
test.describe("ADR-0009 amendment: the Signalement icon (issue #375)", () => {
  test("is committed, named and tooltipped « Signalement », and never the only way in", () => {
    const adr = read("docs/adr/0009-accessibility-floor-for-senior-audience.md");
    const section = /## Amendment: [^\n]*Signalement[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(adr);
    expect(section, "an amendment about the Signalement icon").not.toBeNull();
    const text = section![1]!;
    expect(text).toMatch(/#375/);
    expect(text).toMatch(/icon alone/);
    expect(text).toMatch(/Mon compte/);
    expect(text).toMatch(/aria-label/);
    expect(text).toMatch(/tooltip/);
    expect(text).toContain("« Signalement »");
    expect(text).toMatch(/44 ?px/);
    expect(text).toMatch(/never the only way in/);
    expect(text).toContain("« Signaler un problème »");
    expect(text).toContain("« Proposer une idée »");
    expect(text).toMatch(/#345/);
    expect(text).toMatch(/Every other function still needs a visible label/);
  });
});
