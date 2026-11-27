import { bootIOSSimulator, type BootTools } from "./ios-simulator-boot";
import { SIMULATOR } from "./devices";

const HOME = "/Users/runner";
const NO_RUNTIME = "No runtime specified, using 'iOS 26.5 (26.5 - 23F77) - com.apple.CoreSimulator.SimRuntime.iOS-26-5'\n";
const UDIDS = ["59408972-45B1-4431-B3E4-EE671C2F92D0", "A145228F-085F-4DC8-93D9-C3729C6E1315", "0826802C-5153-4562-90A2-99A48CD1ED8E"];

type Boot = "booted" | "migration failed" | "failed";

/**
 * A Mac whose simulators boot as `boots` says, one after the other: CoreSimulator's devices (each one's
 * `.GlobalPreferences.plist`, as `plutil` writes it) and what each boot found there.
 */
function mac(boots: Boot[], { plutilFails = false } = {}) {
  const created: string[] = [];
  const prefs = new Map<string, { AppleLanguages?: string[]; AppleLocale?: string }>();
  const booted: { udid: string; languages?: string[]; locale?: string }[] = [];
  const events: string[] = [];
  const warnings: string[] = [];
  const current = () => created.at(-1)!;
  const tools: BootTools = {
    run(command) {
      const [tool, ...args] = command;
      events.push(command.join(" "));
      if (tool === "mkdir") return { ok: true, stdout: "", output: "" };
      if (tool === "plutil") {
        if (plutilFails) return { ok: false, stdout: "", output: "plutil: permission denied" };
        const path = args.at(-1)!;
        if (args[0] === "-create") prefs.set(path, {});
        else if (args[1] === "AppleLanguages") prefs.get(path)!.AppleLanguages = JSON.parse(args[3]!) as string[];
        else if (args[1] === "AppleLocale") prefs.get(path)!.AppleLocale = args[3];
        return { ok: true, stdout: "", output: "" };
      }
      const [, verb] = args;
      if (verb === "create") {
        created.push(UDIDS[created.length]!);
        // As on the macOS runner (runs 45892292896, 45892306325): with no runtime named, `simctl create` prints the
        // UDID on stdout, then Xcode's choice of runtime on stderr.
        const notice = args.length === 4 ? NO_RUNTIME : "";
        return { ok: true, stdout: `${current()}\n`, output: `${current()}\n${notice}` };
      }
      const outcome = boots[booted.length - (verb === "bootstatus" ? 1 : 0)] ?? "booted";
      if (verb === "boot") {
        const seen = prefs.get(`${HOME}/Library/Developer/CoreSimulator/Devices/${current()}/data/Library/Preferences/.GlobalPreferences.plist`);
        booted.push({ udid: current(), languages: seen?.AppleLanguages, locale: seen?.AppleLocale });
        return { ok: outcome !== "failed", stdout: "", output: "" };
      }
      if (verb === "bootstatus") {
        const output = outcome === "migration failed" ? "\tWaiting on Data Migration\n\tData Migration Failed\n" : "\tWaiting on System App\n\tFinished\n";
        return { ok: true, stdout: output, output };
      }
      return { ok: true, stdout: "", output: "" };
    },
    pause: (seconds) => void events.push(`pause ${seconds}`),
    warn: (message) => void warnings.push(message),
  };
  return { tools, created, booted, events, warnings };
}

const french = { languages: ["fr-FR"], locale: "fr_FR" };

describe("the iOS simulator's first boot in CI (#1170)", () => {
  it("creates the simulator in French before its first boot, so that run.ts never boots it a second time for its language", () => {
    const { tools, booted, events } = mac(["booted"]);
    expect(bootIOSSimulator({ model: "iPhone SE (3rd generation)", runtime: "", home: HOME }, tools)).toBe(UDIDS[0]);
    expect(booted).toEqual([{ udid: UDIDS[0], ...french }]);
    expect(events[0]).toBe(`xcrun simctl create ${SIMULATOR} iPhone SE (3rd generation)`);
    expect(events.slice(-2)).toEqual([`xcrun simctl boot ${SIMULATOR}`, `xcrun simctl bootstatus ${SIMULATOR} -b`]);
  });

  // Runs 45892292896 and 45892306325: the iPhone SE, on Xcode's own runtime, got « No runtime specified, using 'iOS
  // 26.5 …' » on stderr after its UDID, which was then read as the UDID: « The simulator … could not be created ».
  it("reads the UDID from what `simctl create` prints on stdout, not from Xcode's notice on stderr when no runtime is named", () => {
    const { tools, booted, events } = mac(["booted"]);
    expect(bootIOSSimulator({ model: "iPhone SE (3rd generation)", runtime: "", home: HOME }, tools)).toBe(UDIDS[0]);
    expect(events).toContain(`plutil -create binary1 ${HOME}/Library/Developer/CoreSimulator/Devices/${UDIDS[0]}/data/Library/Preferences/.GlobalPreferences.plist`);
    expect(booted).toEqual([{ udid: UDIDS[0], ...french }]);
  });

  it("creates it on the runtime the matrix names", () => {
    const { tools, events } = mac(["booted"]);
    bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-6", home: HOME }, tools);
    expect(events[0]).toBe(`xcrun simctl create ${SIMULATOR} iPad Pro 13-inch (M4) com.apple.CoreSimulator.SimRuntime.iOS-18-6`);
  });

  // Runs 45842667708, 45854413155 and 45876324396: the iPad made anew booted in English (« The simulator's language:
  // en_US »), run.ts rebooted it for French, and the first run on it failed (its sign-in answered in 31 s, or its driver
  // was lost).
  it("makes a simulator whose first boot ends on « Data Migration Failed » anew, French too before its boot", () => {
    const { tools, booted, events, warnings } = mac(["migration failed", "booted"]);
    expect(bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "", home: HOME }, tools)).toBe(UDIDS[1]);
    expect(booted).toEqual([{ udid: UDIDS[0], ...french }, { udid: UDIDS[1], ...french }]);
    expect(events).toEqual(expect.arrayContaining([`xcrun simctl shutdown ${SIMULATOR}`, `xcrun simctl delete ${SIMULATOR}`]));
    expect(events.indexOf(`xcrun simctl delete ${SIMULATOR}`)).toBeLessThan(events.lastIndexOf(`xcrun simctl create ${SIMULATOR} iPad Pro 13-inch (M4)`));
    expect(warnings).toEqual([expect.stringContaining("Data Migration Failed")]);
  });

  it("makes a simulator whose first boot fails anew, French too before its boot", () => {
    const { tools, booted } = mac(["failed", "booted"]);
    expect(bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "", home: HOME }, tools)).toBe(UDIDS[1]);
    expect(booted).toEqual([{ udid: UDIDS[0], ...french }, { udid: UDIDS[1], ...french }]);
  });

  it("goes on, warned, with a simulator whose data migration failed twice, and makes none a third time", () => {
    const { tools, created, warnings } = mac(["migration failed", "migration failed"]);
    expect(bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "", home: HOME }, tools)).toBe(UDIDS[1]);
    expect(created).toHaveLength(2);
    expect(warnings.at(-1)).toContain("twice");
  });

  it("fails the job when the simulator does not boot twice", () => {
    const { tools, created } = mac(["failed", "failed"]);
    expect(() => bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "", home: HOME }, tools)).toThrow("did not boot");
    expect(created).toHaveLength(2);
  });

  it("does not boot a simulator it could not set to French", () => {
    const { tools, booted } = mac(["booted"], { plutilFails: true });
    expect(() => bootIOSSimulator({ model: "iPad Pro 13-inch (M4)", runtime: "", home: HOME }, tools)).toThrow("French");
    expect(booted).toEqual([]);
  });
});
