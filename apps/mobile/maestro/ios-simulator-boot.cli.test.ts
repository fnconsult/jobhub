/**
 * End to end, through the CLI mobile-e2e.yml runs on the macOS runner (#1170):
 *   npx tsx apps/mobile/maestro/ios-simulator-boot.ts "<model>" "<runtime>"
 * The real process runs against fake `xcrun`, `plutil` and `sleep` executables first on PATH, with a throwaway HOME as
 * CoreSimulator's: what the process does to the simulators, and what they find on their disks at boot, is observed.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SIMULATOR } from "./devices";

const ROOT = resolve(__dirname, "../../..");
const CLI = join(__dirname, "ios-simulator-boot.ts");
const TSX = join(ROOT, "node_modules/.bin/tsx");
const UDIDS = ["59408972-45B1-4431-B3E4-EE671C2F92D0", "A145228F-085F-4DC8-93D9-C3729C6E1315", "0826802C-5153-4562-90A2-99A48CD1ED8E"];

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ios-boot-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** Fake Xcode tools: `boots` is the outcome of each boot in turn (bootstatus' output, or a failing `boot`). */
function runCli(boots: string[], args: string[] = ["iPad Pro 13-inch (M4)", "com.apple.CoreSimulator.SimRuntime.iOS-18-6"]) {
  const bin = join(dir, "bin");
  const home = join(dir, "home");
  mkdirSync(bin);
  mkdirSync(home);
  const log = join(dir, "log.jsonl");
  const state = join(dir, "state");
  writeFileSync(state, "0 0");
  const script = (name: string, body: string) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  script("sleep", `echo "sleep $1" >> ${log}`);
  // plutil: really write what it is asked, as a JSON file at the plist's path, so that boot can read it back.
  script("plutil", `
echo "plutil $*" >> ${log}
f="\${@: -1}"
case "$1" in
  -create) echo '{}' > "$f" ;;
  -insert) key="$2"; if [ "$3" = "-json" ]; then val="$4"; else val="\\"$4\\""; fi
    node -e 'const fs=require("fs");const [f,k,v]=process.argv.slice(1);const o=JSON.parse(fs.readFileSync(f));o[k]=JSON.parse(v);fs.writeFileSync(f,JSON.stringify(o))' "$f" "$key" "$val" ;;
esac`);
  script("xcrun", `
echo "xcrun $*" >> ${log}
read created boots < ${state}
case "$2" in
  create) idx=$created; echo $((created+1)) $boots > ${state}
    case $idx in 0) echo ${UDIDS[0]};; 1) echo ${UDIDS[1]};; *) echo ${UDIDS[2]};; esac
    # As on the macOS runner (runs 45892292896, 45892306325): no runtime named, Xcode's choice on stderr, after the UDID.
    [ $# -eq 4 ] && echo "No runtime specified, using 'iOS 26.5 (26.5 - 23F77) - com.apple.CoreSimulator.SimRuntime.iOS-26-5'" >&2
    exit 0 ;;
  boot) udid=$(ls ${home}/Library/Developer/CoreSimulator/Devices 2>/dev/null | tail -n +$created | head -1)
    prefs="${home}/Library/Developer/CoreSimulator/Devices/$(ls -t ${home}/Library/Developer/CoreSimulator/Devices | head -1)/data/Library/Preferences/.GlobalPreferences.plist"
    echo "BOOT $(cat "$prefs" 2>/dev/null)" >> ${log}
    outcome=$(echo '${JSON.stringify(boots)}' | node -e 'const b=JSON.parse(require("fs").readFileSync(0));console.log(b[Number(process.argv[1])]||"booted")' $boots)
    echo $((boots+1)) > /dev/null; echo $created $((boots+1)) > ${state}
    [ "$outcome" = "failed" ] && exit 1; exit 0 ;;
  bootstatus) outcome=$(echo '${JSON.stringify(boots)}' | node -e 'const b=JSON.parse(require("fs").readFileSync(0));console.log(b[Number(process.argv[1])-1]||"booted")' $boots)
    if [ "$outcome" = "migration failed" ]; then printf '\\tData Migration Failed\\n'; else printf '\\tFinished\\n'; fi ;;
  *) : ;;
esac`);
  const result = spawnSync(TSX, [CLI, ...args], {
    encoding: "utf8",
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home } as unknown as NodeJS.ProcessEnv,
  });
  const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { ...result, lines, boots: lines.filter((l) => l.startsWith("BOOT")), creates: lines.filter((l) => l.startsWith("xcrun simctl create")) };
}

function dirname(path: string) { return path.slice(0, path.lastIndexOf("/")); }

const FRENCH = /"AppleLanguages":\["fr-FR"\]/;
const LOCALE = /"AppleLocale":"fr_FR"/;

describe("ios-simulator-boot.ts as the macOS runner runs it (#1170)", () => {
  it("boots the simulator French from its first boot, on the runtime named, without a second boot", () => {
    const r = runCli(["booted"]);
    expect(r.status).toBe(0);
    expect(r.creates).toEqual([`xcrun simctl create ${SIMULATOR} iPad Pro 13-inch (M4) com.apple.CoreSimulator.SimRuntime.iOS-18-6`]);
    expect(r.boots).toHaveLength(1);
    expect(r.boots[0]).toMatch(FRENCH);
    expect(r.boots[0]).toMatch(LOCALE);
    expect(r.lines.some((l) => l.includes("simctl shutdown") || l.includes("simctl delete"))).toBe(false);
  });

  it("makes the simulator anew after « Data Migration Failed », French too before its first boot (the cause of #1170)", () => {
    const r = runCli(["migration failed", "booted"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
    expect(r.creates).toHaveLength(2);
    expect(r.lines).toContain(`xcrun simctl delete ${SIMULATOR}`);
    expect(r.lines).toContain("sleep 20");
    expect(r.boots).toHaveLength(2);
    for (const boot of r.boots) { expect(boot).toMatch(FRENCH); expect(boot).toMatch(LOCALE); }
  });

  it("makes the simulator anew after a first boot that fails", () => {
    const r = runCli(["failed", "booted"]);
    expect(r.status).toBe(0);
    expect(r.creates).toHaveLength(2);
    expect(r.boots[1]).toMatch(FRENCH);
  });

  it("goes on, warned, when the data migration fails twice, and makes no third simulator", () => {
    const r = runCli(["migration failed", "migration failed"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("failed twice");
    expect(r.creates).toHaveLength(2);
  });

  it("fails the job when the simulator does not boot twice", () => {
    const r = runCli(["failed", "failed"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("did not boot, twice");
  });

  // Runs 45892292896 and 45892306325: the iPhone SE job, with no runtime, read Xcode's notice on stderr as its UDID.
  it("omits the runtime when none is named (Xcode's own), and boots it French despite Xcode's notice on stderr", () => {
    const r = runCli(["booted"], ["iPhone SE (3rd generation)", ""]);
    expect(r.stderr).toContain("No runtime specified");
    expect(r.status).toBe(0);
    expect(r.creates).toEqual([`xcrun simctl create ${SIMULATOR} iPhone SE (3rd generation)`]);
    expect(r.lines).toContain(`plutil -create binary1 ${join(dir, "home")}/Library/Developer/CoreSimulator/Devices/${UDIDS[0]}/data/Library/Preferences/.GlobalPreferences.plist`);
    expect(r.boots).toHaveLength(1);
    expect(r.boots[0]).toMatch(FRENCH);
  });

  it("refuses to run without a model", () => {
    const r = runCli(["booted"], []);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("usage");
  });
});
