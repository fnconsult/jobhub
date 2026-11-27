/**
 * The iOS simulator a CI job creates and boots for its Maestro runs (mobile-e2e.yml, #705, #1170):
 *
 *   npx tsx apps/mobile/maestro/ios-simulator-boot.ts "<model>" "<runtime identifier, or empty for Xcode's own>"
 *
 * Each simulator it creates is French before its first boot (its `.GlobalPreferences.plist` written beforehand), so
 * that run.ts never boots it a second time to take the language (`bootSetup`, devices.ts). A first boot that fails, or
 * ends on « Data Migration Failed » (the iPad's, on the runtime just downloaded: runs 42700565743, 42888727550,
 * 45842667708), has the simulator deleted and made anew, once: French too. The one made anew used to boot in English,
 * and the second boot run.ts gave it left the first run on it failing (#1170).
 */
import { spawnSync } from "node:child_process";
import { SIMULATOR } from "./devices";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIES = 2;

export type BootTools = {
  /**
   * Runs `command`: whether it ended well, what it wrote on stdout, and all it wrote (stdout then stderr). What a
   * command answers is on its stdout alone: `simctl create` with no runtime named writes its UDID there, then « No
   * runtime specified, using 'iOS 26.5 …' » on stderr (runs 45892292896, 45892306325).
   */
  run: (command: string[]) => { ok: boolean; stdout: string; output: string };
  pause: (seconds: number) => void;
  warn: (message: string) => void;
};

const system: BootTools = {
  run(command) {
    const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return { ok: result.status === 0, stdout, output: `${stdout}${stderr}` };
  },
  pause(seconds) { spawnSync("sleep", [String(seconds)]); },
  warn(message) { console.log(`::warning::${message}`); },
};

/** The simulator's system language and region, French: the app's default language, whose labels the flows look for. */
function setFrench(udid: string, home: string, tools: BootTools) {
  const dir = `${home}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/Preferences`;
  const prefs = `${dir}/.GlobalPreferences.plist`;
  const written = [
    ["mkdir", "-p", dir],
    ["plutil", "-create", "binary1", prefs],
    ["plutil", "-insert", "AppleLanguages", "-json", '["fr-FR"]', prefs],
    ["plutil", "-insert", "AppleLocale", "-string", "fr_FR", prefs],
  ].every((command) => tools.run(command).ok);
  if (!written) throw new Error(`The simulator ${udid} could not be set to French before its first boot`);
}

/** Creates the simulator `SIMULATOR` of `model` (on `runtime`, if one is named), French, and boots it: its UDID. */
export function bootIOSSimulator({ model, runtime, home }: { model: string; runtime: string; home: string }, tools: BootTools = system): string {
  for (let attempt = 1; ; attempt++) {
    const created = tools.run(["xcrun", "simctl", "create", SIMULATOR, model, ...(runtime ? [runtime] : [])]);
    const udid = created.stdout.trim();
    if (!created.ok || !UUID.test(udid)) throw new Error(`The simulator ${model} could not be created`);
    setFrench(udid, home, tools);

    // `bootstatus` ends well even on « Data Migration Failed »: its output tells.
    const status = tools.run(["xcrun", "simctl", "boot", SIMULATOR]).ok ? tools.run(["xcrun", "simctl", "bootstatus", SIMULATOR, "-b"]) : null;
    const booted = status?.ok ?? false;
    const migrated = booted && !status!.output.includes("Data Migration Failed");
    if (migrated) return udid;
    if (attempt === TRIES) {
      if (!booted) throw new Error(`The simulator ${model} did not boot, twice`);
      tools.warn("The simulator's data migration failed twice: going on with it");
      return udid;
    }
    tools.warn(`The simulator's first boot ${booted ? "ended on « Data Migration Failed »" : "failed"}: deleted and made anew`);
    tools.run(["xcrun", "simctl", "shutdown", SIMULATOR]);
    if (!tools.run(["xcrun", "simctl", "delete", SIMULATOR]).ok) throw new Error("The simulator whose first boot failed could not be deleted");
    tools.pause(20);
  }
}

if (require.main === module) {
  const [model, runtime = ""] = process.argv.slice(2);
  if (!model) throw new Error('usage: ios-simulator-boot.ts "<model>" "<runtime>"');
  bootIOSSimulator({ model, runtime, home: process.env.HOME! });
}
