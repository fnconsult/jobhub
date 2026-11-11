/** Recovery of this CI job's dedicated iOS simulator after Maestro preparation times out. */
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { SIMULATOR } from "./devices";

const DRIVER = "dev.mobile.maestro-driver-iosUITests.xctrunner";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maestro 2.11's XCRunnerCLIUtils gives its xcodebuild this destination and private derived-data directory.
 * https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/maestro-ios-driver/src/main/kotlin/util/XCRunnerCLIUtils.kt
 */
export function maestroDriverPids(processes: string, udid: string): number[] {
  if (!UUID.test(udid)) throw new Error("Invalid dedicated simulator UDID");
  return processes.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match) return [];
    const args = match[2]!.trim().split(/\s+/);
    const pid = Number(match[1]);
    const destination = args[args.indexOf("-destination") + 1];
    const derived = args[args.indexOf("-derivedDataPath") + 1];
    return Number.isSafeInteger(pid) && pid > 1 && basename(args[0]!) === "xcodebuild" && args[1] === "test-without-building" && args.includes("-xctestrun")
      && destination?.toLowerCase() === `id=${udid.toLowerCase()}` && derived
      && /^maestro_xctestrunner_xcodebuild_output[^/]*$/.test(basename(derived))
      ? [pid] : [];
  });
}

export type RecoveryTools = {
  read: (command: string[]) => string;
  run: (command: string[]) => void;
  signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  terminate: (udid: string) => void;
  pause: () => void;
};

const system: RecoveryTools = {
  read(command) {
    const result = spawnSync(command[0]!, command.slice(1), { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Cannot inspect iOS recovery state with ${command[0]}`);
    return result.stdout;
  },
  run(command) {
    if (spawnSync(command[0]!, command.slice(1), { stdio: "inherit" }).status !== 0) throw new Error(`iOS driver recovery command failed: ${command.slice(0, 3).join(" ")}`);
  },
  signal(pid, signal) {
    try { process.kill(pid, signal); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  },
  terminate(udid) { spawnSync("xcrun", ["simctl", "terminate", udid, DRIVER], { stdio: "ignore" }); },
  pause() { spawnSync("sleep", ["2"]); },
};

function dedicatedSimulator(tools: RecoveryTools): { udid: string; state: string } {
  const listing = JSON.parse(tools.read(["xcrun", "simctl", "list", "devices", "-j"])) as { devices: Record<string, { name: string; udid: string; state: string; isAvailable?: boolean }[]> };
  const matches = Object.values(listing.devices).flat().filter((device) => device.name === SIMULATOR && device.isAvailable !== false);
  if (matches.length !== 1 || !UUID.test(matches[0]!.udid)) throw new Error("Cannot uniquely identify the dedicated Maestro simulator; no processes stopped");
  return matches[0]!;
}

/** Never stop another Xcode build or another simulator's driver. Re-read commands before escalating a still-owned PID. */
function stopDriver(udid: string, tools: RecoveryTools) {
  const owned = () => maestroDriverPids(tools.read(["ps", "-axo", "pid=,command="]), udid);
  const pids = owned();
  for (const pid of pids) tools.signal(pid, "SIGTERM");
  if (pids.length) {
    tools.pause();
    const remaining = owned();
    for (const pid of remaining) tools.signal(pid, "SIGKILL");
    if (remaining.length) tools.pause();
    if (owned().length) throw new Error("Maestro's old XCTest process is still alive; refusing another driver launch");
  }
  // It may already have exited. The simulator shutdown below also stops its processes.
  tools.terminate(udid);
}

function stopSimulator(tools: RecoveryTools) {
  const simulator = dedicatedSimulator(tools);
  stopDriver(simulator.udid, tools);
  if (simulator.state !== "Shutdown") tools.run(["xcrun", "simctl", "shutdown", simulator.udid]);
  return simulator.udid;
}

/** A timeout can leave xcodebuild alive: Maestro 2.11 skips uninstall while its HTTP channel is unavailable. */
export function recoverIOSDriver(tools: RecoveryTools = system) {
  const udid = stopSimulator(tools);
  tools.run(["xcrun", "simctl", "boot", udid]);
  tools.run(["xcrun", "simctl", "bootstatus", udid, "-b"]);
}

/** Only preparation gets one retry. Theme/text/status-bar settings are restored after the recovery reboot. */
export function prepareIOSRun(prepare: () => boolean, restore: () => boolean, recovery = { restart: recoverIOSDriver, stop: () => { stopSimulator(system); } }): boolean {
  if (prepare()) return true;
  recovery.restart();
  if (!restore()) throw new Error("iOS settings could not be restored after driver recovery");
  if (prepare()) return true;
  // Stop before another configuration starts a third overlapping XCTest runner on this unhealthy simulator.
  recovery.stop();
  throw new Error("Maestro iOS preparation failed twice after driver recovery; no further simulator runs started");
}
