/**
 * The commands of a shell line, as the repo's PreToolUse hooks read them (no-legal-merge.mjs, no-promotion.mjs).
 * Each is its words, quotes removed; `;`, `&&`, `||`, `|`, `&`, a new line, `$(`, a backtick or a parenthesis ends one.
 * Not a shell: a hook refuses what it recognises, and errs towards seeing more commands, not fewer.
 */
const WORDS = /[ \t\r]*(?:(;|&&|\|\||\||&|\n|\$\(|`|\(|\))|"((?:\\.|[^"\\])*)"|'([^']*)'|((?:\\.|[^\s;&|"'`()])+))/g;

/** The commands of `line`, each its list of words. */
export function commands(line) {
  const all = [[]];
  for (const [, separator, double, single, bare] of line.matchAll(WORDS)) {
    if (separator) all.push([]);
    else all.at(-1).push(double ?? single ?? bare);
  }
  return all.filter((words) => words.length > 0);
}

/** The commands of `line` and those quoted inside it (`bash -c "…"`, `eval '…'`), a few levels deep. */
export function allCommands(line, depth = 0) {
  const found = commands(line);
  if (depth >= 3) return found;
  return found.concat(found.flatMap((words) => words.filter((word) => /\s/.test(word)).flatMap((word) => allCommands(word, depth + 1))));
}

/** Where `program` (`git`, `gh`) is called in `words`, by name or by path (`/usr/bin/git`). */
export function callsOf(words, program) {
  return words.flatMap((word, at) => (word.split("/").at(-1) === program ? [at] : []));
}
