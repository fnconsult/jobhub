// The e2e web server's processes end with whoever started them.
//
// Playwright starts e2e/support/web-server.mjs, which starts `npx next start`, which
// starts next-server (directly, or through `sh -c`, depending on the machine). When
// Playwright is killed outright (SIGKILL, a timed-out shell), nothing signals the rest
// of that chain: npx and next-server were left running, reparented to launchd/init,
// their stdout a socket nobody reads. next-server then spins on EPIPE (an uncaught
// write error, logged to the same dead pipe, again and again) at a quarter of a core
// each, for hours; enough of them left the machine too loaded to sign anyone in within
// the suite's timeouts.
//
// Importing this module makes the process exit as soon as its parent is gone.
// web-server.mjs imports it, and `exitWithParentEnv` preloads it into the processes it
// starts, through NODE_OPTIONS, naming web-server.mjs as the process they all exit
// with: a shell in between, which has no watchdog of its own, cannot keep next-server
// running after web-server.mjs is gone.
import { fileURLToPath } from "node:url";

const CHECK_EVERY_MS = 500;
const WATCHED = "E2E_EXIT_WITH_PID";

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

const parent = process.ppid;
const launcher = Number(process.env[WATCHED]) || null;
setInterval(() => {
  // Orphaned: the process was handed to launchd/init (or a subreaper), its parent pid changed;
  // or the launcher that started the chain is gone.
  if (process.ppid !== parent || (launcher !== null && launcher !== process.pid && !alive(launcher))) process.exit(1);
}, CHECK_EVERY_MS).unref();

const self = fileURLToPath(import.meta.url);

/** `env` for a child process that exits with this one, and so do the processes it starts with that env. */
export function exitWithParentEnv(env) {
  const preload = `--import=${self}`;
  const options = env.NODE_OPTIONS ?? "";
  return {
    ...env,
    NODE_OPTIONS: options.includes(preload) ? options : `${options} ${preload}`.trim(),
    [WATCHED]: String(process.pid),
  };
}
