import { describe, expect, it } from "vitest";
import { utf8LocaleFor } from "./locale";

// #544: under a POSIX locale (a bare Linux container's), Chromium names a download whose name goes beyond ASCII
// « download », as it cannot write that name in the locale's charset: export.spec.ts then read a PDF as a Word file.
describe("utf8LocaleFor: the locale the suite's browsers name their downloads in", () => {
  it("sets UTF-8 on a Linux machine with no locale, or a POSIX one", () => {
    expect(utf8LocaleFor({}, "linux")).toEqual({ LC_ALL: "C.UTF-8" });
    expect(utf8LocaleFor({ LANG: "C" }, "linux")).toEqual({ LC_ALL: "C.UTF-8" });
    expect(utf8LocaleFor({ LANG: "fr_FR.UTF-8", LC_ALL: "POSIX" }, "linux")).toEqual({ LC_ALL: "C.UTF-8" });
  });

  it("keeps a UTF-8 locale the machine already has, whatever variable says it", () => {
    expect(utf8LocaleFor({ LANG: "C.UTF-8" }, "linux")).toEqual({});
    expect(utf8LocaleFor({ LANG: "C", LC_CTYPE: "fr_FR.utf8" }, "linux")).toEqual({});
    expect(utf8LocaleFor({ LC_ALL: "en_US.UTF-8" }, "linux")).toEqual({});
  });

  it("leaves a Mac alone: its Chromium does not name files in the locale's charset", () => {
    expect(utf8LocaleFor({}, "darwin")).toEqual({});
  });
});
