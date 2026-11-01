type Env = Record<string, string | undefined>;

/**
 * The locale variables the suite sets so its browsers run with a UTF-8 character type, or none when the shell has one.
 *
 * Chromium on Linux writes a download's name in the locale's character type. Under no locale (POSIX: a bare container
 * or sandbox) it cannot write a name outside ASCII, « CV-Zoë-Łukasz.pdf » or « CV-結城-花子.pdf », and names the file
 * « download » instead, the Content-Disposition header notwithstanding (e2e/export.spec.ts). C.UTF-8 changes only the
 * character type: messages, dates and numbers stay as the shell has them. LC_ALL outranks LC_CTYPE, so a non-UTF-8
 * LC_ALL is the one replaced.
 */
export function utf8CharacterType(env: Env = process.env): Env {
  const characterType = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  if (/utf-?8/i.test(characterType)) return {};
  return env.LC_ALL ? { LC_ALL: "C.UTF-8" } : { LC_CTYPE: "C.UTF-8" };
}
