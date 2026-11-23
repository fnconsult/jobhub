import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `JSON.parse` silently keeps the last occurrence of a repeated key, so a block duplicated in a
// translation catalogue (typically left by a merge that kept both sides of a conflict) changes
// nothing at run time until someone edits the first copy: that edit is then silently ignored.
// Neither the key-parity test (packages/shared/src/i18n/i18n.test.ts) nor tsc can see it, since
// both only ever look at the parsed object. So the catalogue files are read as text here.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const catalogues = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => /(^|\/)_?locales\/.*\.json$/.test(file));

/** Every key that appears more than once in the same object of a JSON text, as a dotted path. */
function duplicateKeysIn(text: string): string[] {
  const duplicates: string[] = [];
  let at = 0;
  const skipSpace = () => {
    while (/\s/.test(text[at] ?? "")) at += 1;
  };
  const readString = (): string => {
    const start = at;
    at += 1;
    while (text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
    at += 1;
    return JSON.parse(text.slice(start, at)) as string;
  };
  const readValue = (path: string): void => {
    skipSpace();
    const char = text[at];
    if (char === "{") {
      at += 1;
      const seen = new Set<string>();
      skipSpace();
      while (text[at] !== "}") {
        skipSpace();
        const key = readString();
        if (seen.has(key)) duplicates.push(`${path}${key}`);
        seen.add(key);
        skipSpace();
        at += 1; // the ":" between key and value
        readValue(`${path}${key}.`);
        skipSpace();
        if (text[at] === ",") at += 1;
        skipSpace();
      }
      at += 1;
    } else if (char === "[") {
      at += 1;
      skipSpace();
      let index = 0;
      while (text[at] !== "]") {
        readValue(`${path}${index}.`);
        index += 1;
        skipSpace();
        if (text[at] === ",") at += 1;
        skipSpace();
      }
      at += 1;
    } else if (char === '"') {
      readString();
    } else {
      while (at < text.length && !/[\s,}\]]/.test(text[at] ?? "")) at += 1;
    }
  };
  readValue("");
  return duplicates;
}

describe("translation catalogue files", () => {
  it("spots a key repeated in the same object, at any depth", () => {
    expect(duplicateKeysIn('{"a": {"b": 1, "c": [1, {"d": "x\\"y"}], "b": 2}, "e": true, "a": null}')).toEqual([
      "a.b",
      "a",
    ]);
  });

  it("does not mistake the same key in two different objects for a repetition", () => {
    expect(duplicateKeysIn('{"a": {"label": "x"}, "b": {"label": "y"}}')).toEqual([]);
  });

  it("covers the interface catalogues and the extension's", () => {
    expect(catalogues).toEqual(
      expect.arrayContaining([
        "packages/shared/src/i18n/locales/fr.json",
        "packages/shared/src/i18n/locales/en.json",
        "apps/extension/public/_locales/fr/messages.json",
      ]),
    );
  });

  it.each(catalogues)("%s never repeats a key in the same object", (file) => {
    expect(duplicateKeysIn(readFileSync(join(root, file), "utf8"))).toEqual([]);
  });
});
