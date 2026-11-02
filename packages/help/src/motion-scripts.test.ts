import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readHelpContent, HelpContentError } from "./content";
import { checkMotionLinks, parseAction, parseMotionScript, readAppRoutes, readMotionScripts } from "./motion-scripts-content";
import { motionFileKey, motionTranscript, narrationSentences, plainNarration, routeMatches } from "./motion-scripts";
import { motionScript, motionScriptsFilming } from "./index";

/** Writes `files` ({ "fr/x.md": "…" }) into a fresh directory with fr/ and en/. */
function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "help-motions-"));
  mkdirSync(path.join(dir, "fr"));
  mkdirSync(path.join(dir, "en"));
  for (const [file, markdown] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), markdown);
  }
  return dir;
}

const scriptFr = `---
title: Retrouver une candidature
routes: [/candidatures, /candidatures/[id]]
---
## Vos candidatures
- goto /candidatures
- zoom main

« Mes candidatures » liste vos candidatures. La plus **récente** est en haut.

## Ouvrir une candidature
- click link « Responsable comptable »
- zoom off

Cliquez sur « Responsable comptable » : sa page s'ouvre.
`;
const scriptEn = `---
title: Find an application
routes: [/candidatures, /candidatures/[id]]
---
## Your applications
- goto /candidatures
- zoom main

“My applications” lists your applications. The newest is at the top.

## Open an application
- click link "Responsable comptable"
- zoom off

Click “Responsable comptable”: its page opens.
`;

const tutorial = (motion: string, title = "Retrouver une candidature") => `---
kind: tutorial
audience: candidate
topic: utiliser
title: ${title}
synonyms: [candidature]
motion: ${motion}
---
1. Ouvrez « Mes candidatures ».
2. Cliquez sur une candidature.
`;

describe("parseMotionScript — one Motion Script", () => {
  it("reads its title, routes, steps with their capture actions and narration, and a hash of the file", () => {
    const { script, problems } = parseMotionScript("retrouver-candidature", "fr", scriptFr);
    expect(problems).toEqual([]);
    expect(script).toMatchObject({
      id: "retrouver-candidature",
      locale: "fr",
      title: "Retrouver une candidature",
      viewer: "candidate",
      routes: ["/candidatures", "/candidatures/[id]"],
      steps: [
        {
          title: "Vos candidatures",
          actions: [
            { action: "goto", path: "/candidatures" },
            { action: "zoom", target: { by: "role", role: "main", name: null } },
          ],
          narration: "« Mes candidatures » liste vos candidatures. La plus **récente** est en haut.",
        },
        {
          title: "Ouvrir une candidature",
          actions: [
            { action: "click", target: { by: "role", role: "link", name: "Responsable comptable" } },
            { action: "zoom", target: null },
          ],
        },
      ],
    });
    expect(script.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(parseMotionScript("x", "fr", scriptFr.replace("plus", "moins")).script.hash).not.toBe(script.hash);
  });

  it.each([
    ["no routes", scriptFr.replace("routes: [/candidatures, /candidatures/[id]]\n", ""), /routes is missing/],
    ["a goto outside its routes", scriptFr.replace("- goto /candidatures", "- goto /agenda"), /goto \/agenda is in none of the routes it declares/],
    ["a step without narration", scriptFr.replace("Cliquez sur « Responsable comptable » : sa page s'ouvre.", ""), /step « Ouvrir une candidature » has no narration/],
    ["an unknown action", scriptFr.replace("- zoom off", "- dance now"), /unknown capture action « dance »/],
    ["an unknown role", scriptFr.replace("- click link", "- click lien"), /unknown role « lien »/],
    ["a button without its name", scriptFr.replace("- click link « Responsable comptable »", "- click button"), /a button is named/],
    ["a first step that opens no page", scriptFr.replace("- goto /candidatures\n", ""), /the first step starts with « - goto <path> »/],
    ["an action after the narration", scriptFr.replace("est en haut.", "est en haut.\n- click button \"Ok\""), /capture actions come before the narration/],
    ["an unknown viewer", scriptFr.replace("title:", "viewer: recruiter\ntitle:"), /viewer must be candidate or visitor/],
  ])("refuses %s", (_, markdown, problem) => {
    expect(parseMotionScript("x", "fr", markdown).problems.join("\n")).toMatch(problem);
  });

  it("parses each action: fill with its text, press, scroll, by label or by text", () => {
    expect(parseAction('fill label "Intitulé du poste" "Responsable comptable"')).toEqual({
      action: "fill",
      target: { by: "label", text: "Intitulé du poste" },
      text: "Responsable comptable",
    });
    expect(parseAction("fill textbox « Rechercher » « relance »")).toEqual({ action: "fill", target: { by: "role", role: "textbox", name: "Rechercher" }, text: "relance" });
    expect(parseAction("press Enter")).toEqual({ action: "press", key: "Enter" });
    expect(parseAction('scroll text "Aucune candidature"')).toEqual({ action: "scroll", target: { by: "text", text: "Aucune candidature" } });
    expect(parseAction('hover button "Aide et coach"')).toEqual({ action: "hover", target: { by: "role", role: "button", name: "Aide et coach" } });
    expect(parseAction("goto candidatures")).toMatch(/goto takes a path/);
    expect(parseAction("fill label \"Intitulé\"")).toMatch(/label needs its quoted text|the name is one quoted text|fill needs/);
  });
});

describe("readMotionScripts — the scripts of a directory", () => {
  it("reads each script in French and English", () => {
    const scripts = readMotionScripts(dirWith({ "fr/retrouver.md": scriptFr, "en/retrouver.md": scriptEn }));
    expect(scripts.fr.map((script) => script.title)).toEqual(["Retrouver une candidature"]);
    expect(scripts.en.map((script) => script.title)).toEqual(["Find an application"]);
  });

  it("refuses a script without its translation", () => {
    expect(() => readMotionScripts(dirWith({ "fr/retrouver.md": scriptFr }))).toThrow(
      new HelpContentError("en/retrouver.md is missing: every Motion Script is written in French and in English"),
    );
  });

  it("refuses an English script whose steps or actions differ from the French one", () => {
    const fewer = scriptEn.slice(0, scriptEn.indexOf("## Open"));
    expect(() => readMotionScripts(dirWith({ "fr/retrouver.md": scriptFr, "en/retrouver.md": fewer }))).toThrow(/it has 1 steps, the French one 2/);
    const other = scriptEn.replace('- click link "Responsable comptable"', '- click button "Responsable comptable"');
    expect(() => readMotionScripts(dirWith({ "fr/retrouver.md": scriptFr, "en/retrouver.md": other }))).toThrow(/step 2 « Open an application » plays click button, zoom off, the French one click link, zoom off/);
  });

  it("reads nothing from a directory without scripts", () => {
    expect(readMotionScripts(path.join(tmpdir(), "no-such-motions"))).toEqual({ fr: [], en: [] });
  });
});

describe("checkMotionLinks — Tutorials and their Motion Scripts", () => {
  const scripts = () => readMotionScripts(dirWith({ "fr/retrouver.md": scriptFr, "en/retrouver.md": scriptEn }));
  const content = (motion: string) => readHelpContent(dirWith({ "fr/tutorial-retrouver.md": tutorial(motion), "en/tutorial-retrouver.md": tutorial(motion, "Find an application") }));
  const routes = ["/candidatures", "/candidatures/[id]"];

  it("accepts a Tutorial naming its script, which films pages of the app", () => {
    expect(() => checkMotionLinks(content("retrouver"), scripts(), routes)).not.toThrow();
  });

  it("refuses a Tutorial whose motion names no script, and a script no Tutorial names", () => {
    expect(() => checkMotionLinks(content("inconnu"), scripts(), routes)).toThrow(/fr\/tutorial-retrouver\.md: its motion inconnu names no Motion Script/);
    expect(() => checkMotionLinks(content("inconnu"), scripts(), routes)).toThrow(/motions\/fr\/retrouver\.md: no Tutorial names it/);
  });

  it("refuses a declared route that is no page of the web app", () => {
    expect(() => checkMotionLinks(content("retrouver"), scripts(), ["/candidatures"])).toThrow(/route \/candidatures\/\[id\] is no page of the web app/);
  });

  it("refuses a motion on an article that is no tutorial", () => {
    const faq = tutorial("retrouver").replace("kind: tutorial", "kind: faq");
    expect(() => readHelpContent(dirWith({ "fr/faq-x.md": faq, "en/faq-x.md": faq }))).toThrow(/only a tutorial has a motion/);
  });
});

describe("readAppRoutes — the web app's pages", () => {
  it("lists route patterns, route groups and catch-alls left out", () => {
    const app = dirWith({
      "page.tsx": "",
      "candidatures/page.tsx": "",
      "candidatures/[id]/page.tsx": "",
      "profils/[id]/(sections)/propositions/page.tsx": "",
      "admin/[...missing]/page.tsx": "",
    });
    expect(readAppRoutes(app)).toEqual(["/", "/candidatures", "/candidatures/[id]", "/profils/[id]/propositions"]);
  });

  it("knows this app's Help Centre and Applications", () => {
    expect(readAppRoutes()).toEqual(expect.arrayContaining(["/aide", "/candidatures", "/candidatures/[id]"]));
  });
});

describe("narration, transcript and routes", () => {
  const { script } = parseMotionScript("retrouver", "fr", scriptFr);

  it("writes the descriptive transcript: title, « Voix de synthèse », each step", () => {
    expect(motionTranscript(script)).toBe(
      [
        "# Retrouver une candidature",
        "",
        "Transcription. Voix de synthèse.",
        "",
        "## Vos candidatures",
        "",
        "« Mes candidatures » liste vos candidatures. La plus **récente** est en haut.",
        "",
        "## Ouvrir une candidature",
        "",
        "Cliquez sur « Responsable comptable » : sa page s'ouvre.",
        "",
      ].join("\n"),
    );
    expect(motionTranscript(parseMotionScript("retrouver", "en", scriptEn).script)).toContain("Transcript. Synthetic voice.");
  });

  it("splits the narration into sentences without Markdown, never inside a « … » quote", () => {
    expect(plainNarration("La plus **récente**\n est `en haut`.")).toBe("La plus récente est en haut.");
    expect(narrationSentences("Cliquez sur « Envoyer. Puis fermer ». Puis attendez ! C'est fait… Voilà")).toEqual([
      "Cliquez sur « Envoyer. Puis fermer ».",
      "Puis attendez !",
      "C'est fait…",
      "Voilà",
    ]);
  });

  it("matches a page against a route pattern, under /en too", () => {
    expect(routeMatches("/candidatures/[id]", "/candidatures/abc?x=1")).toBe(true);
    expect(routeMatches("/candidatures/[id]", "/candidatures")).toBe(false);
    expect(routeMatches("/aide", "/en/aide")).toBe(true);
    expect(routeMatches("/", "/en")).toBe(true);
  });

  it("names the bucket key of each published file", () => {
    expect(motionFileKey("retrouver", "en", "0123456789ab", "captions")).toBe("retrouver/en/0123456789ab/captions.vtt");
  });

  it("serves this build's scripts by id (none yet: #570 writes them)", () => {
    expect(motionScript("inconnu", "fr")).toBeNull();
    expect(motionScriptsFilming("/candidatures")).toEqual([]);
  });
});
