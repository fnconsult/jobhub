import { describe, expect, it } from "vitest";
import { copyName, fitProfileName, PROFILE_NAME_MAX_LENGTH } from "./limits";

const copyOf = (name: string) => `${name} (copie)`;

describe("Profile names", () => {
  it("leaves a name that fits as it is, trimmed", () => {
    expect(fitProfileName("  Directrice financière ")).toBe("Directrice financière");
  });

  it("shortens a name that is too long at a word boundary", () => {
    const name = fitProfileName(`${"Responsable ".repeat(12)}financier`);

    expect(name).toBe("Responsable ".repeat(10).trim());
  });

  it("cuts a single word that is too long at the limit", () => {
    expect(fitProfileName("R".repeat(300))).toBe("R".repeat(PROFILE_NAME_MAX_LENGTH));
  });

  it("suggests a copy name that always fits, keeping the suffix", () => {
    expect(copyName("DAF", copyOf)).toBe("DAF (copie)");

    const long = copyName("x".repeat(118), copyOf);
    expect(long).toHaveLength(PROFILE_NAME_MAX_LENGTH);
    expect(long.endsWith(" (copie)")).toBe(true);
  });
});
