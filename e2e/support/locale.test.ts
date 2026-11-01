import { describe, expect, it } from "vitest";
import { utf8Locale } from "./locale";

// Chromium on Linux names a download in the machine's character set: under the POSIX locale (no LANG, as in a bare
// container) a file called « CV-結城-花子.pdf » is saved as « download », and export.spec.ts reads a PDF as a Word file.
describe("utf8Locale: the locale the suite's browsers and servers get", () => {
  it("adds a UTF-8 character type when the machine sets no locale (POSIX)", () => {
    expect(utf8Locale({})).toEqual({ LC_CTYPE: "C.UTF-8" });
    expect(utf8Locale({ LANG: "C" })).toEqual({ LC_CTYPE: "C.UTF-8" });
    expect(utf8Locale({ LANG: "fr_FR.ISO-8859-1" })).toEqual({ LC_CTYPE: "C.UTF-8" });
  });

  it("replaces LC_ALL when it holds a locale that is not UTF-8: it wins over LC_CTYPE", () => {
    expect(utf8Locale({ LC_ALL: "POSIX", LANG: "en_US.UTF-8" })).toEqual({ LC_ALL: "C.UTF-8" });
  });

  it("leaves a UTF-8 locale alone, however it is set (CI's runners, a developer's machine)", () => {
    expect(utf8Locale({ LANG: "C.UTF-8" })).toEqual({});
    expect(utf8Locale({ LANG: "fr_FR.utf8" })).toEqual({});
    expect(utf8Locale({ LC_CTYPE: "en_US.UTF-8" })).toEqual({});
    expect(utf8Locale({ LC_ALL: "en_GB.UTF-8", LANG: "C" })).toEqual({});
  });
});
