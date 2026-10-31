type Env = Record<string, string | undefined>;

const UTF8 = /\.utf-?8$/i;

/**
 * What to add to the environment so the suite's browsers and servers run in a UTF-8 locale, whatever the machine's.
 * Chromium on Linux writes a download's name in the locale's character set: under POSIX (no LANG, a bare container)
 * it cannot write « CV-結城-花子.pdf » and saves the file as « download », with no extension. CI's runners are UTF-8.
 * The effective character type is LC_ALL's, else LC_CTYPE's, else LANG's; only the character type changes.
 */
export function utf8Locale(env: Env): Env {
  if (env.LC_ALL) return UTF8.test(env.LC_ALL) ? {} : { LC_ALL: "C.UTF-8" };
  return UTF8.test(env.LC_CTYPE || env.LANG || "") ? {} : { LC_CTYPE: "C.UTF-8" };
}
