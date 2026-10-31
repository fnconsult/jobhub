type Env = Record<string, string | undefined>;

/**
 * The locale variables the e2e suite sets so its browsers name downloads as a person's would (#544). Chromium on Linux
 * writes a download's name in the locale's charset: under none, or POSIX (a bare container's), a name beyond ASCII,
 * « CV-Zoë-….pdf », becomes « download ». CI's runners are UTF-8 already, as most machines are: then nothing changes.
 */
export function utf8LocaleFor(env: Env, platform: NodeJS.Platform): Env {
  if (platform !== "linux") return {};
  const ctype = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/i.test(ctype) ? {} : { LC_ALL: "C.UTF-8" };
}
