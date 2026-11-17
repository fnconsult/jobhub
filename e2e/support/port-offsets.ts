// Issue #1015: the port offsets the e2e specs ask for (e2e/support/ports.ts), read from their source, so that a test can
// check no two specs share one (e2e/support/port-offsets.test.ts).

/** The support helpers whose first argument is a port offset: derivedPort and the helpers that start a server on one. */
const HELPERS = ["derivedPort", "startOwnServer", "startServer", "startSignInServer"];

/**
 * The port offsets `source`, a spec, asks for: the first argument of every call to a helper of HELPERS, or to a function
 * of its own whose first parameter is `offset`. That argument is a number, a constant set to one in the spec
 * (`const PORT_OFFSET = 605`), or an `offset` variable or property, whose values are the spec's `offset: <number>`
 * properties. Any other argument is refused: an offset this cannot read could hide a clash.
 */
export function portOffsets(source: string): number[] {
  const own = [...source.matchAll(/(?:function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\()\s*offset\b/g)].map(([, fn, arrow]) => fn ?? arrow);
  const constants = new Map([...source.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(\d+)\s*;/g)].map(([, name, value]) => [name, Number(value)]));
  const properties = [...source.matchAll(/\boffset:\s*(\d+)\b/g)].map(([, value]) => Number(value));
  const calls = new RegExp(`(?<!function\\s+)\\b(?:${[...HELPERS, ...own].join("|")})\\(\\s*([^,)]*?)\\s*[,)]`, "g");
  const offsets = new Set<number>();
  let fromProperties = false;
  for (const [, argument] of source.matchAll(calls)) {
    if (/^\d+$/.test(argument)) offsets.add(Number(argument));
    else if (constants.has(argument)) offsets.add(constants.get(argument)!);
    else if (/^(?:\w+\.)?offset$/.test(argument)) fromProperties = true;
    else if (!/^offset\s*:/.test(argument)) throw new Error(`Cannot read the port offset « ${argument} »: give a number, a constant set to one, or an \`offset\` property.`);
  }
  if (fromProperties) for (const offset of properties) offsets.add(offset);
  return [...offsets];
}

/** Each offset that more than one of `specs` asks for, with those specs' files, sorted. */
export function portOffsetClashes(specs: { file: string; source: string }[]): { offset: number; files: string[] }[] {
  const files = new Map<number, string[]>();
  for (const { file, source } of specs) {
    for (const offset of portOffsets(source)) files.set(offset, [...(files.get(offset) ?? []), file]);
  }
  return [...files]
    .filter(([, asking]) => asking.length > 1)
    .map(([offset, asking]) => ({ offset, files: asking.sort() }))
    .sort((a, b) => a.offset - b.offset);
}
