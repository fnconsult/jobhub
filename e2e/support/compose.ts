import { spawnSync } from "node:child_process";

/** The exit status of `bin args…` (null when it could not be started). */
export type Status = (bin: string, args: string[]) => number | null;

const run: Status = (bin, args) => spawnSync(bin, args, { stdio: "ignore" }).status;

const CLIS = [["docker", "compose"], ["docker-compose"]];

/**
 * The docker compose command line (`docker compose`, else `docker-compose`), or [] when compose cannot run here, so the
 * specs that drive the local stack skip. `version` answers from the CLI alone, with no daemon behind it (a sandbox with
 * the CLI and no /var/run/docker.sock), so the daemon is asked too: `ps` under a project of nobody's lists its containers.
 */
export function composeCommand(status: Status = run): string[] {
  const cli = CLIS.find(([bin, ...base]) => status(bin!, [...base, "version"]) === 0);
  if (!cli) return [];
  const [bin, ...base] = cli;
  return status(bin!, [...base, "-p", "jobhub-e2e-daemon-probe", "ps", "-q"]) === 0 ? cli : [];
}
