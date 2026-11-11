import { expect, it, vi } from "vitest";
import { createEmailSourceReader } from "../../apps/worker/src/email-intake/source-reading";
import { emailSourceFetch } from "./email-source-pages";

it("the browser email harness reads complete fictional public sources with the real polite reader", async () => {
  const generate = vi.fn(async () => { throw new Error("The complete fixture needs no AI extraction"); });
  const reader = createEmailSourceReader({ fetch: emailSourceFetch, clock: { now: () => 0, sleep: async () => {} } });
  const source = await reader("https://www.cadremploi.fr/emploi/detail_offre?offreId=158700001", { generate } as never);
  expect(source.details).toMatchObject({ title: "Contrôleur de gestion industriel", content: expect.stringContaining("PUBLIC_EMAIL_SOURCE"), skills: ["IFRS"], requiredExperienceYears: 10, contractType: "cdi" });
  expect(generate).not.toHaveBeenCalled();
});
it("the browser fixture refuses an unrecognized source without any real network fallback", async () => {
  await expect(emailSourceFetch("https://careers.example.org/jobs/unexpected")).rejects.toThrow("Unexpected");
});
