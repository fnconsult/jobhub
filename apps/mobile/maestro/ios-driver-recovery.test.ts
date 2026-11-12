import { maestroDriverPids, prepareIOSRun, recoverIOSDriver, type RecoveryTools } from "./ios-driver-recovery";

const UDID = "E1A1E3C1-9E3B-4E55-9EDF-E0AB4A9D6D4B";
const OTHER = "85DD941F-E4CF-498C-B1D9-D5B3E0F0E2DD";
const driver = (pid: number, udid = UDID, derived = "/tmp/maestro_xctestrunner_xcodebuild_output1250") =>
  `${pid} /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild test-without-building -xctestrun /tmp/maestro-driver.xctestrun -destination id=${udid} -derivedDataPath ${derived}`;

it("selects only the dedicated simulator's Maestro xcodebuild, never another build, simulator, wrapper or system PID", () => {
  expect(maestroDriverPids([
    driver(91), driver(92, OTHER), driver(93, UDID, "/tmp/another-project"), driver(1), driver(0),
    `94 sh -c ${driver(95)}`, "96 /usr/bin/xcodebuild build -project Jobbbox.xcodeproj", "97 ps -axo pid=,command=",
  ].join("\n"), UDID)).toEqual([91]);
  expect(() => maestroDriverPids(driver(91), "not-a-udid")).toThrow("Invalid");
});

function host({ resistant = false, ambiguous = false, immortal = false, reused = false } = {}) {
  const processes = new Map([[91, driver(91)], [92, driver(92, OTHER)], [93, driver(93, UDID, "/tmp/unrelated-build")]]);
  const events: string[] = [];
  const tools: RecoveryTools = {
    read(command) {
      if (command[0] === "ps") return [...processes.values()].join("\n");
      return JSON.stringify({ devices: { runtime: [
        { name: "maestro", udid: UDID, state: "Booted", isAvailable: true },
        ...(ambiguous ? [{ name: "maestro", udid: OTHER, state: "Shutdown", isAvailable: true }] : []),
      ] } });
    },
    run(command) { events.push(command.slice(1).join(" ")); },
    signal(pid, signal) {
      events.push(`${signal}:${pid}`);
      if (!immortal && (signal === "SIGKILL" || !resistant)) processes.delete(pid);
    },
    terminate(udid) { events.push(`terminate:${udid}`); },
    pause() { if (reused) processes.set(91, driver(91, UDID, "/tmp/another-project")); },
  };
  return { tools, events, processes };
}

it("stops an orphan before rebooting its simulator; another simulator and an unrelated build survive", () => {
  const { tools, events, processes } = host({ resistant: true });
  recoverIOSDriver(tools);
  expect([...processes.keys()]).toEqual([92, 93]);
  expect(events).toEqual([
    "SIGTERM:91", "SIGKILL:91", `terminate:${UDID}`, `simctl shutdown ${UDID}`, `simctl boot ${UDID}`, `simctl bootstatus ${UDID} -b`,
  ]);
});

it("rechecks ownership before SIGKILL so a reused PID is not killed", () => {
  const { tools, events, processes } = host({ resistant: true, reused: true });
  recoverIOSDriver(tools);
  expect(events).not.toContain("SIGKILL:91");
  expect(processes.has(91)).toBe(true);
});

it("refuses ambiguous simulators and refuses to reboot while a matching orphan is still alive", () => {
  const ambiguous = host({ ambiguous: true });
  expect(() => recoverIOSDriver(ambiguous.tools)).toThrow("uniquely identify");
  expect(ambiguous.events).toEqual([]);
  const immortal = host({ immortal: true });
  expect(() => recoverIOSDriver(immortal.tools)).toThrow("still alive");
  expect(immortal.events).toEqual(["SIGTERM:91", "SIGKILL:91"]);
});

it("does not recover a successful preparation; after a failure it restores device settings before its one retry", () => {
  const recovery = { restart: jest.fn(), stop: jest.fn() };
  const restore = jest.fn(() => true);
  expect(prepareIOSRun(() => true, restore, recovery)).toBe(true);
  expect(recovery.restart).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();

  let restored = false;
  let attempts = 0;
  expect(prepareIOSRun(() => ++attempts === 1 ? false : restored, () => (restored = true), recovery)).toBe(true);
  expect(attempts).toBe(2);
  expect(recovery.restart).toHaveBeenCalledTimes(1);
  expect(recovery.stop).not.toHaveBeenCalled();
});

it("fails the hardware job after its second preparation failure, cleans the orphan, and never launches a third", () => {
  const prepare = jest.fn(() => false);
  const recovery = { restart: jest.fn(), stop: jest.fn() };
  expect(() => prepareIOSRun(prepare, () => true, recovery)).toThrow("failed twice");
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(recovery.restart).toHaveBeenCalledTimes(1);
  expect(recovery.stop).toHaveBeenCalledTimes(1);
});

it("never retries preparation when recovery or restoring the device settings fails", () => {
  const prepare = jest.fn(() => false);
  expect(() => prepareIOSRun(prepare, () => true, { restart: () => { throw new Error("cannot stop orphan"); }, stop: jest.fn() })).toThrow("cannot stop orphan");
  expect(prepare).toHaveBeenCalledTimes(1);
  prepare.mockClear();
  expect(() => prepareIOSRun(prepare, () => false, { restart: jest.fn(), stop: jest.fn() })).toThrow("settings could not be restored");
  expect(prepare).toHaveBeenCalledTimes(1);
});
