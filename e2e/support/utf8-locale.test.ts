import { describe, expect, it } from "vitest";
import { utf8CharacterType } from "./utf8-locale";

// Chromium on Linux writes a download's name in the locale's character type. Under no locale (POSIX, a bare container
// or sandbox) it cannot write « CV-Zoë-Łukasz.pdf » or « CV-結城-花子.pdf », and names the file « download »: the export
// spec then reads the PDF as a Word file. The suite gives its browsers a UTF-8 character type whatever the shell has.
describe("utf8CharacterType: the locale variables the suite sets so Chromium can name downloads in any script", () => {
  it("sets a UTF-8 character type when the shell has no locale", () => {
    expect(utf8CharacterType({})).toEqual({ LC_CTYPE: "C.UTF-8" });
  });

  it("sets one when the shell's locale is not UTF-8", () => {
    expect(utf8CharacterType({ LANG: "C" })).toEqual({ LC_CTYPE: "C.UTF-8" });
    expect(utf8CharacterType({ LANG: "fr_FR.UTF-8", LC_CTYPE: "POSIX" })).toEqual({ LC_CTYPE: "C.UTF-8" });
  });

  it("replaces LC_ALL when it names a locale that is not UTF-8, as it outranks LC_CTYPE", () => {
    expect(utf8CharacterType({ LC_ALL: "C", LANG: "en_US.UTF-8" })).toEqual({ LC_ALL: "C.UTF-8" });
  });

  it("leaves a UTF-8 locale alone, however it is spelled and wherever it is set", () => {
    expect(utf8CharacterType({ LANG: "C.UTF-8" })).toEqual({});
    expect(utf8CharacterType({ LANG: "fr_FR.utf8" })).toEqual({});
    expect(utf8CharacterType({ LC_CTYPE: "en_US.UTF-8" })).toEqual({});
    expect(utf8CharacterType({ LC_ALL: "de_DE.UTF-8", LANG: "C" })).toEqual({});
  });
});
