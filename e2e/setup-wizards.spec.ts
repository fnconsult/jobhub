import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Issue #73: the Stripe setup wizards (scripts/setup/issue-22.sh, issue-24.sh) re-ask
// for a price ID that does not start with price_, and explain the mix-up when a
// product ID (prod_…) is pasted. Each wizard runs as a person would run it, with
// the answers typed on stdin, a throwaway ENV_FILE, and a stand-in browser opener.
let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "jobhub-wizard-"));
  // open_url tries wslview first: a no-op one keeps the real browser closed.
  const bin = path.join(dir, "bin");
  spawnSync("mkdir", ["-p", bin]);
  writeFileSync(path.join(bin, "wslview"), "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(bin, "wslview"), 0o755);
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

function runWizard(script: string, answers: string[]) {
  const envFile = path.join(dir, "test.env");
  const result = spawnSync("bash", [script], {
    input: answers.map((a) => `${a}\n`).join(""),
    encoding: "utf8",
    env: { ...process.env, ENV_FILE: envFile, PATH: `${path.join(dir, "bin")}:${process.env.PATH}` },
    timeout: 30_000,
  });
  let written = "";
  try {
    written = readFileSync(envFile, "utf8");
  } catch {
    // nothing written
  }
  return { ...result, written };
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

test.describe("Stripe setup wizards", () => {
  test("issue-22: entering prod_x at the Standard price prompt warns and asks again; the price ID is saved", () => {
    const run = runWizard("scripts/setup/issue-22.sh", [
      "", // Ready to start?
      "", // test mode: Done?
      "sk_test_e2e",
      "prod_x", // Standard: a product ID
      "price_standard_e2e",
      "price_premium_e2e",
      "", // customer portal: Done?
      "y", // local development with the Stripe CLI
      "whsec_e2e",
      "admin@e2e.jobbbox.test",
    ]);

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(count(run.stdout, "Paste the Standard monthly price ID:")).toBe(2);
    expect(run.stdout).toContain("That is a product ID (prod_…), not a price ID.");
    expect(run.stdout).toContain("copy the ID that starts with price_");
    expect(count(run.stdout, "Paste the Premium monthly price ID:")).toBe(1);
    expect(run.written).toContain("STRIPE_PRICE_STANDARD=price_standard_e2e\n");
    expect(run.written).toContain("STRIPE_PRICE_PREMIUM=price_premium_e2e\n");
    expect(run.written).not.toContain("prod_x");
  });

  test("issue-22: a value that is neither price_ nor prod_ is re-asked too, and five wrong answers stop the wizard without saving", () => {
    const run = runWizard("scripts/setup/issue-22.sh", ["", "", "sk_test_e2e", "prod_x", "abc", "prod_y", "nope", "prod_z", "price_late"]);

    expect(run.status).not.toBe(0);
    expect(count(run.stdout, "Paste the Standard monthly price ID:")).toBe(5);
    expect(run.stdout).toContain("A Stripe price ID starts with price_.");
    expect(run.stdout).toContain("re-run the wizard");
    expect(run.written).not.toContain("STRIPE_PRICE_STANDARD");
  });

  test("issue-24: a product ID for either Coaching Session price is re-asked; both price IDs are saved", () => {
    const run = runWizard("scripts/setup/issue-24.sh", [
      "", // Ready to start?
      "prod_session",
      "price_session_e2e",
      "prod_session",
      "price_session_premium_e2e",
      "", // pause
      "y", // Stripe CLI
      "", // Done?
      "", // Done?
    ]);

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(count(run.stdout, "Paste the regular Coaching Session price ID:")).toBe(2);
    expect(count(run.stdout, "Paste the Premium Coaching Session price ID:")).toBe(2);
    expect(count(run.stdout, "That is a product ID (prod_…), not a price ID.")).toBe(2);
    expect(run.written).toContain("STRIPE_PRICE_COACHING_SESSION=price_session_e2e\n");
    expect(run.written).toContain("STRIPE_PRICE_COACHING_SESSION_PREMIUM=price_session_premium_e2e\n");
    expect(run.written).not.toContain("prod_session");
  });
});
