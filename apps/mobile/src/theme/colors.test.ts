import { colorsFor } from "./colors";

describe("colorsFor", () => {
  it("reads the Design System's tokens in the system's theme", () => {
    expect(colorsFor("light").background).toBe("#ffffff");
    expect(colorsFor("dark").background).toBe("#121219");
    expect(colorsFor("dark").accent).toBe("#8d9bff");
  });

  it("writes the translucent tokens as React Native reads them", () => {
    expect(colorsFor("light").scrim).toBe("rgba(20, 20, 40, 0.28)");
    expect(colorsFor("dark").scrim).toBe("rgba(0, 0, 0, 0.5)");
  });
});
