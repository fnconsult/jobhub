import { test } from "@playwright/test";
import pg from "pg";
import { signInWithMagicLink } from "./support/candidate";
import { newAddress } from "./support/mailbox";
test("qa261", async ({ browser }) => {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL }); await db.connect();
  const at = new Date(Date.now() - 3 * 86_400_000);
  await db.query("DELETE FROM guardrail_trigger WHERE guardrail='harmful_advice'");
  for (const r of ["provider_error", "provider_error", null]) await db.query("INSERT INTO guardrail_trigger (guardrail,setting,action,agent,at,reason) VALUES ('harmful_advice','block','unavailable','ai_coach',$1,$2)", [at, r]);
  await db.query("INSERT INTO guardrail_trigger (guardrail,setting,action,agent,at) VALUES ('harmful_advice','block','blocked','ai_coach',$1)", [at]);
  let bad = ""; try { await db.query("INSERT INTO guardrail_trigger (guardrail,setting,action,agent,at,reason) VALUES ('harmful_advice','block','blocked','ai_coach',now(),'provider_error')"); } catch (e) { bad = (e as { code?: string }).code ?? ""; }
  try { await db.query("INSERT INTO guardrail_trigger (guardrail,setting,action,agent,at,reason) VALUES ('harmful_advice','block','unavailable','ai_coach',now(),'bogus')"); } catch (e) { bad += " " + (e as { code?: string }).code; }
  console.log("CHECK-VIOLATIONS", bad);
  for (const locale of ["fr-FR", "en-US"]) {
    const ctx = await browser.newContext({ baseURL: process.env.E2E_WEB_ORIGIN, locale });
    const page = await ctx.newPage();
    await signInWithMagicLink(page, "guardrails-office@e2e.jobbbox.test");
    await page.goto("/admin/garde-fous");
    const t = page.locator("table").filter({ hasText: /./ }).last();
    console.log(locale, "ROWS", (await t.innerText()).slice(0, 600).replace(/\n/g, " | "));
    await t.screenshot({ path: `/tmp/pw261-${locale}.png` });
    await ctx.close();
  }
  const c = await browser.newContext({ baseURL: process.env.E2E_WEB_ORIGIN }); const p = await c.newPage();
  await signInWithMagicLink(p, newAddress("qa261-cand"));
  const res = await p.goto("/admin/garde-fous"); console.log("CANDIDATE STATUS", res?.status());
  await db.query("DELETE FROM guardrail_trigger WHERE guardrail='harmful_advice'"); await db.end();
});
