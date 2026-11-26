import { textSizeOf } from "./SignalementForm";

// What a Signalement says of how the person reads (#1152): the web's Petit is 0.75 of its Standard since 2026-11-26,
// so a system scale is « small » from halfway down to it, not from just under 1.
describe("textSizeOf", () => {
  it("names the system's text scale as the web's Text Size", () => {
    expect(textSizeOf(0.82)).toBe("small");
    expect(textSizeOf(0.88)).toBe("standard");
    expect(textSizeOf(0.94)).toBe("standard");
    expect(textSizeOf(1)).toBe("standard");
    expect(textSizeOf(1.2)).toBe("large");
    expect(textSizeOf(2)).toBe("xlarge");
  });
});
