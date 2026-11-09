import { describe, expect, it } from "vitest";
import { composeCommand } from "./compose";

// stack.spec.ts and worker-env.spec.ts skip when docker compose cannot run. `docker compose version` answers from the
// CLI alone, daemon or not: in a sandbox with the CLI and no daemon the guard let them run, and each failed on
// « failed to connect to the docker API at unix:///var/run/docker.sock » instead of skipping.
type Call = { bin: string; args: string[] };

/** A machine where `answers` says which commands exit 0; records every call. */
function machine(answers: (call: Call) => boolean) {
  const calls: Call[] = [];
  const status = (bin: string, args: string[]) => {
    calls.push({ bin, args });
    return answers({ bin, args }) ? 0 : 1;
  };
  return { status, calls };
}

const daemonCall = ({ args }: Call) => args.includes("ps");

describe("composeCommand: the docker compose CLI, only when its daemon answers", () => {
  it("is docker compose when the plugin and the daemon answer", () => {
    const { status } = machine(({ bin, args }) => bin === "docker" && args[0] === "compose");
    expect(composeCommand(status)).toEqual(["docker", "compose"]);
  });

  it("is docker-compose (v1) when only it is installed and the daemon answers", () => {
    const { status } = machine(({ bin }) => bin === "docker-compose");
    expect(composeCommand(status)).toEqual(["docker-compose"]);
  });

  it("is nothing when the CLI answers but no daemon does (no /var/run/docker.sock)", () => {
    const { status, calls } = machine((call) => !daemonCall(call));
    expect(composeCommand(status)).toEqual([]);
    expect(calls.some(daemonCall), "the daemon was asked, not only the CLI's version").toBe(true);
  });

  it("is nothing when no compose CLI is installed", () => {
    const { status } = machine(() => false);
    expect(composeCommand(status)).toEqual([]);
  });
});
