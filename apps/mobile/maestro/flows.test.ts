// The Maestro flows run only on CI's simulators and emulators (#705). This checks, on every run of the app's tests, what
// can be checked without them: each flow is a Maestro file of the app, and every label it looks for is one the app shows
// (its French strings, or the seeded stack's data), so a renamed label fails here rather than on a simulator.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadAll } from "js-yaml";
import fr from "../../../packages/shared/src/i18n/locales/fr.json";
import appJson from "../app.json";
import { disposition } from "../src/shell/disposition";
import { CI_HARDWARE, DEVICES, runsOn } from "./devices";
import { KEY_SCREENS, MAESTRO_SEED, STACK_ENV } from "./seed";

const ROOT = __dirname;
const filesIn = (dir: string, extension: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(dir, entry.name), extension) : entry.name.endsWith(extension) ? [join(dir, entry.name)] : [],
  );
const FLOW_FILES = [...filesIn(join(ROOT, "flows"), ".yaml"), ...filesIn(join(ROOT, "subflows"), ".yaml")];
/** Subflows that drive the system's own screens (iPadOS's multitasking menu, iOS's alerts), whose labels are not the app's. */
const SYSTEM_FLOWS = new Set([join(ROOT, "subflows", "split-view.yaml"), join(ROOT, "subflows", "system-alerts.yaml")]);

type Header = { appId?: string; name?: string; tags?: string[] };
type Command = Record<string, unknown> | string;
const parse = (file: string) => {
  const [header, commands] = loadAll(readFileSync(file, "utf8")) as [Header, Command[]];
  return { header, commands };
};

/** Every value under `key` anywhere in `node`. */
function valuesOf(node: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(node)) return node.flatMap((each) => valuesOf(each, keys));
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => [...(keys.includes(key) ? [value] : []), ...valuesOf(value, keys)]);
}

/** The text selectors of a flow: the short form (`tapOn: "Envoyer"`) and the `text:` of a long one. */
function labelsIn(commands: Command[]): string[] {
  const selectors = valuesOf(commands, ["tapOn", "assertVisible", "assertNotVisible", "visible", "notVisible", "element", "scrollUntilVisible"]);
  const texts = valuesOf(commands, ["text"]).filter((each): each is string => typeof each === "string");
  // A subflow's label given by its caller: the Sidebar's link (menu.yaml).
  const given = valuesOf(commands, ["env"]).flatMap((env) => (env && typeof env === "object" ? [(env as Record<string, unknown>).MENU, (env as Record<string, unknown>).LABEL, (env as Record<string, unknown>).TEXT] : []));
  return [...selectors, ...texts, ...given].filter((label): label is string => typeof label === "string" && !label.includes("${"));
}

/** Every string the app shows in French, a placeholder `{{name}}` standing for any text. */
const strings = (node: unknown): string[] => (typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(strings) : []);
/** A string that is only placeholders (« {{name}} ») would stand for any label: left out. */
const FRENCH = strings(fr).filter((text) => text.replace(/\{\{\w+\}\}/g, "").trim() !== "");
const SEEDED = strings(MAESTRO_SEED);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const asPattern = (text: string) => new RegExp(`^${text.split(/\{\{\w+\}\}/).map(escape).join(".+")}$`, "s");

/** Whether Maestro's selector, a regular expression matched against a whole text, finds a string the app or the seed shows. */
function shown(selector: string): boolean {
  const pattern = new RegExp(`^(?:${selector})$`, "s");
  return [...FRENCH, ...SEEDED].some((text) => pattern.test(text) || asPattern(text).test(selector.replace(/\\(.)/g, "$1")));
}

const TEST_IDS = new Set(
  filesIn(join(ROOT, "..", "src"), ".tsx").flatMap((file) => [...readFileSync(file, "utf8").matchAll(/testID="([^"]+)"/g)].map((match) => match[1]!)),
);

describe("the Maestro flows (#705)", () => {
  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s is a flow of the app: its header, then its commands", (_name, file) => {
    const { header, commands } = parse(file);
    expect(header.appId).toBe(appJson.expo.ios.bundleIdentifier);
    expect(appJson.expo.android.package).toBe(header.appId);
    expect(Array.isArray(commands)).toBe(true);
  });

  it("goes through the journeys of the issue, each a flow, and the key screens", () => {
    const tagged = Object.fromEntries(filesIn(join(ROOT, "flows"), ".yaml").map((file) => [relative(join(ROOT, "flows"), file), parse(file).header.tags]));
    expect(tagged).toEqual({
      "1-connexion.yaml": ["flow"],
      "2-ecrans-cles.yaml": ["key-screens"],
      "3-accueil.yaml": ["flow"],
      "4-candidature.yaml": ["flow"],
      "5-recherches.yaml": ["flow"],
      "6-agenda.yaml": ["flow"],
      "7-conversation.yaml": ["flow"],
    });
  });

  it("runs them in the order of their files, by their names, the key screens right after sign-in", () => {
    const config = loadAll(readFileSync(join(ROOT, "config.yaml"), "utf8"))[0] as { executionOrder: { flowsOrder: string[] } };
    const names = filesIn(join(ROOT, "flows"), ".yaml")
      .sort()
      .map((file) => parse(file).header.name);
    expect(config.executionOrder.flowsOrder).toEqual(names);
  });

  // On an iPad in portrait (64.5rem) the run's layout is columns, but an Application's Fiche, open beside the
  // conversation, leaves the Sidebar no room: it goes to the drawer, and the flows found no « Recherches d'offres » (#705).
  it("goes to a Sidebar link through « Menu » whenever the shell shows it, whatever the run's layout", () => {
    const columnsYetDrawer = DEVICES.filter((device) => {
      const window = { width: device.size.width, fontScale: 1 };
      const page = disposition(window, { sidebar: true, pane: null, workPane: false });
      const withFiche = disposition(window, { sidebar: true, pane: "fiche", workPane: false });
      return page.panes === "columns" && page.sidebar === "column" && withFiche.sidebar === "drawer";
    });
    expect(columnsYetDrawer.map((device) => device.id)).toContain("ipad-portrait");
    const { commands } = parse(join(ROOT, "subflows", "menu.yaml"));
    const opensDrawer = commands.find((command) => typeof command === "object" && JSON.stringify(command).includes('"tapOn":"Menu"')) as { runFlow: { when: Record<string, unknown> } };
    expect(opensDrawer.runFlow.when).toEqual({ visible: "Menu" });
  });

  // iOS's number keyboards have no key that closes them, and Maestro taps what the keyboard covers: on the keyboard. A
  // tap on the field's label typed a « v » on an iPhone SE, the next ones its dictation key (#705). The field's keyboard
  // is closed on iOS by a drag near the pane's top, which its body closes the keyboard on; no tap but the field's own.
  it("closes a field's keyboard on iOS by a drag in the pane, never by a tap", () => {
    const { commands } = parse(join(ROOT, "subflows", "field.yaml"));
    expect(valuesOf(commands, ["tapOn"])).toEqual([{ id: "${FIELD}" }]);
    const ios = (valuesOf(commands, ["runFlow"]) as { when?: { platform?: string }; commands?: Command[] }[]).find((branch) => branch.when?.platform === "iOS");
    const drags = valuesOf(ios?.commands, ["swipe"]) as { start: string; end: string }[];
    expect(drags.length).toBeGreaterThan(0);
    for (const drag of drags) expect(parseFloat(drag.start.split(",")[1]!)).toBeLessThanOrEqual(36);
  });

  // A tablet's Fiche: once the pane scrolled to its button, the Interview form's title « Ajouter l'entretien » was out of
  // view, and « the second of that name » was no more (4-candidature.yaml, #705). Which matches a selector finds is what
  // is in view: a flow names what it taps by a testID, never by its rank among the matches.
  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s picks no match by a rank past the first", (_name, file) => {
    const ranks = valuesOf(parse(file).commands, ["index"]);
    expect(ranks.filter((rank) => rank !== 0)).toEqual([]);
  });

  // Maestro's scrollUntilVisible swipes from the screen's middle by some 40 % of its height and wants its element whole:
  // on a tablet the middle is the conversation, not the pane; on a folded foldable at the largest text size the
  // conversation shows less than such a swipe, and the Agenda's Interview, taller than the rest, was swiped past (#705).
  // A flow scrolls its own column in short steps (subflows/conversation-scroll.yaml, subflows/pane-scroll.yaml).
  it.each(filesIn(join(ROOT, "flows"), ".yaml").map((file) => [relative(ROOT, file), file]))("%s scrolls a column in short steps, not from the screen's middle", (_name, file) => {
    expect(valuesOf(parse(file).commands, ["scrollUntilVisible"])).toEqual([]);
  });

  // iOS gives Maestro an element's whole frame, its part clipped by a scrolling column included: on an iPhone SE the
  // Application's card, scrolled under the Top Bar, was « visible », and the tap on it landed on the page's title (#705).
  // A column's element is then pulled within it: below the top of the thread or the pane's body, above the
  // conversation's box. And a folded foldable at the largest text size scrolled past the card it looked for, to the
  // conversation's start: the steps go back the other way when the first did not find it.
  it.each([
    ["conversation-scroll.yaml", [{ below: { id: "conversation-thread" } }, { above: { id: "conversation-box" } }]],
    ["pane-scroll.yaml", [{ below: { id: "pane-body" } }]],
    ["pane-scroll-id.yaml", [{ below: { id: "pane-body" } }]],
  ])("subflows/%s scrolls both ways, then pulls its element within the column", (name, within) => {
    const { commands } = parse(join(ROOT, "subflows", name));
    const conditions = valuesOf(commands, ["notVisible"]);
    for (const relation of within) expect(conditions).toContainEqual(expect.objectContaining(relation));
    const ways = (valuesOf(commands, ["swipe"]) as { start: string; end: string }[]).map((swipe) => (parseFloat(swipe.start.split(",")[1]!) < parseFloat(swipe.end.split(",")[1]!) ? "UP" : "DOWN"));
    expect(new Set(ways)).toEqual(new Set(["UP", "DOWN"]));
    const branches = valuesOf(commands, ["runFlow"]) as { when?: { true?: string }; commands?: unknown[] }[];
    for (const direction of ["UP", "DOWN"]) {
      const asked = branches.filter((branch) => branch.when?.true === `\${DIRECTION == '${direction}'}`);
      expect(asked.length).toBeGreaterThan(0);
      for (const branch of asked) expect(valuesOf(branch.commands, ["repeat"])).toHaveLength(2);
    }
  });

  // Maestro reads a swipe's percentages as it parses the flow, before any script runs: « ${output.paneX}% » failed to
  // parse, and every flow of the tablet's run with it (#705).
  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s swipes between literal percentages", (_name, file) => {
    const points = (valuesOf(parse(file).commands, ["swipe"]) as Record<string, unknown>[]).flatMap((swipe) => [swipe.start, swipe.end].filter((point) => point !== undefined));
    expect(points.filter((point) => typeof point !== "string" || !/^\d+%, \d+%$/.test(point))).toEqual([]);
  });

  it("scrolls the pane to a field before it types in it, not to its label", () => {
    const { commands } = parse(join(ROOT, "subflows", "field.yaml"));
    expect(commands[0]).toEqual({ runFlow: { file: "pane-scroll-id.yaml", env: { ID: "${FIELD}", DIRECTION: "DOWN" } } });
  });

  // iOS may take what is typed before its keyboard is up: an iPhone SE's code field got its first digit only (#705).
  it.each(FLOW_FILES.filter((file) => valuesOf(parse(file).commands, ["inputText"]).length > 0).map((file) => [relative(ROOT, file), file]))(
    "%s types each value again until iOS shows it all",
    (_name, file) => {
      const { commands } = parse(file);
      const retried = valuesOf(commands, ["retry"]) as { commands: Command[] }[];
      const typed = valuesOf(commands, ["inputText"]) as string[];
      for (const value of typed) {
        const attempt = retried.find((retry) => valuesOf(retry.commands, ["inputText"]).includes(value));
        const checked = attempt ? (valuesOf(attempt.commands, ["assertVisible"]) as string[]) : [];
        expect(checked.map((shown) => shown.replace(/\\(.)/g, "$1"))).toEqual([value]);
      }
    },
  );

  // The Agenda's Interview line, found by « .*Contrôleuse de gestion.* » as iOS names it all, matched on Android its
  // « Ajouter à mon calendrier » too, named for the same Interview: the tap opened Google Agenda (#705).
  it("taps the Agenda's Interview, not the button that adds it to the calendar", () => {
    const button = fr.agenda.calendarFile.addFor.replace("{{what}}", fr.agenda.calendarFile.interviewTitle.replace("{{job}}", MAESTRO_SEED.interview.title).replace("{{employer}}", MAESTRO_SEED.interview.employer)).replace("{{date}}", "mercredi 12 mars 2031 à 14:30");
    const tapped = ["6-agenda.yaml", "2-ecrans-cles.yaml"].flatMap((name) => {
      const { commands } = parse(join(ROOT, "flows", name));
      return [...valuesOf(commands, ["tapOn"]), ...valuesOf(commands, ["env"]).map((env) => (env as Record<string, unknown>).TEXT)].filter((each): each is string => typeof each === "string" && each.includes(`.*${MAESTRO_SEED.interview.title}`));
    });
    expect(tapped.length).toBeGreaterThan(1);
    for (const selector of tapped) {
      expect(new RegExp(`^(?:${selector})$`).test(MAESTRO_SEED.interview.title)).toBe(true);
      expect(new RegExp(`^(?:${selector})$`).test(button)).toBe(false);
    }
  });

  // The fake coach streamed its 30 paragraphs while Maestro's tap on « Envoyer » waited for the screen to settle: the
  // reply had ended, « Arrêter » with it, before the flow looked (the Android tablet, #705). The reply is held back.
  it("sends the conversation a message whose reply comes late enough for « Arrêter » to be seen", () => {
    const held = Number(/E2E_COACH_SLOW=(\d+)/.exec(MAESTRO_SEED.coach.message)?.[1] ?? 0);
    expect(held).toBeGreaterThanOrEqual(10_000);
    const { commands } = parse(join(ROOT, "flows", "7-conversation.yaml"));
    expect(valuesOf(commands, ["inputText"])).toEqual([MAESTRO_SEED.coach.message]);
    const waited = (valuesOf(commands, ["extendedWaitUntil"]) as { visible: string; timeout: number }[]).find((wait) => wait.visible === "Arrêter");
    expect(waited!.timeout).toBeGreaterThan(held);
  });

  // A page opens on its latest message only if it had loaded when its thread was laid out: the foldable's home page was
  // captured at its end on one run and at its start on the next (93 % alike), and a scroll from there stopped elsewhere.
  // Every conversation's key screen starts from the thread's end, after the page is opened (#705).
  it("brings the conversation to its end before each conversation's key screen", () => {
    const { commands } = parse(join(ROOT, "flows", "2-ecrans-cles.yaml"));
    const fromEnd: string[] = [];
    let atEnd = false;
    for (const command of commands) {
      const flow = typeof command === "object" ? (command as { runFlow?: string | { file?: string; env?: Record<string, string> } }).runFlow : undefined;
      const file = typeof flow === "string" ? flow : flow?.file;
      if (file?.endsWith("menu.yaml") || file?.endsWith("close-fiche.yaml")) atEnd = false;
      if (file?.endsWith("conversation-end.yaml")) atEnd = true;
      if (file?.endsWith("capture.yaml") && typeof flow === "object") {
        if (atEnd) fromEnd.push(flow.env!.SCREEN!);
        atEnd = false;
      }
    }
    expect(fromEnd).toEqual(["accueil", "candidatures", "agenda", "conversation"]);
  });

  it("captures each key screen once per run", () => {
    const { commands } = parse(join(ROOT, "flows", "2-ecrans-cles.yaml"));
    const captured = valuesOf(commands, ["env"]).flatMap((env) => (env && typeof env === "object" && "SCREEN" in env ? [String(env.SCREEN)] : []));
    expect(captured).toEqual([...KEY_SCREENS]);
  });

  it.each(FLOW_FILES.filter((file) => !SYSTEM_FLOWS.has(file)).map((file) => [relative(ROOT, file), file]))(
    "%s looks only for labels the app shows in French, or the seeded data",
    (_name, file) => {
      expect(labelsIn(parse(file).commands).filter((label) => !shown(label))).toEqual([]);
    },
  );

  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s finds by id only a testID the app sets", (_name, file) => {
    const { commands } = parse(file);
    // A field's id, given to field.yaml by its caller; an element's, to pane-scroll-id.yaml.
    const fields = valuesOf(commands, ["env"]).flatMap((env) => (env && typeof env === "object" ? [(env as Record<string, unknown>).FIELD, (env as Record<string, unknown>).ID] : []));
    const ids = [...valuesOf(commands, ["id"]), ...fields].filter((each): each is string => typeof each === "string" && !each.includes("${"));
    expect(ids.filter((id) => !TEST_IDS.has(id))).toEqual([]);
  });

  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s runs subflows and scripts that exist", (_name, file) => {
    const { commands } = parse(file);
    const paths = [
      ...valuesOf(commands, ["runFlow", "runScript"]).filter((each): each is string => typeof each === "string"),
      ...valuesOf(commands, ["file"]).filter((each): each is string => typeof each === "string"),
    ];
    expect(paths.filter((path) => !existsSync(join(dirname(file), path)))).toEqual([]);
  });

  it.each(FLOW_FILES.map((file) => [relative(ROOT, file), file]))("%s reads only the variables a run or the stack gives", (_name, file) => {
    const given = new Set([...Object.keys(runsOn(CI_HARDWARE.ipad.id)[0]!.env), ...STACK_ENV, "output", "SCREEN", "MENU", "FIELD", "VALUE", "LABEL", "TEXT", "DIRECTION", "ID"]);
    // The names in each `${…}`, its quoted strings and a property after a dot left out.
    const read = [...readFileSync(file, "utf8").matchAll(/\$\{([^}]+)\}/g)].flatMap((match) =>
      [...match[1]!.replace(/'[^']*'|"[^"]*"/g, "").matchAll(/(?<![.\w])([A-Za-z_]\w*)/g)].map((each) => each[1]!),
    );
    expect(read.filter((name) => !given.has(name))).toEqual([]);
  });
});
