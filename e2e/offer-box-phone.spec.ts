import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import AxeBuilder from "./support/axe";
import { signInWithMagicLink } from "./support/candidate";
import { topBarMoreOf } from "./support/conversation";
import { newAddress } from "./support/mailbox";

// Issue #898 (« Offres à traiter » on a phone): below 40rem the box's header (« Offres à traiter », the count, the progress
// bar, the source chips) is behind a filter icon, the compact Top Bar's action (#897), which opens it as a panel under the
// bar; « Aujourd'hui » says « n arrivées aujourd'hui · N à traiter »; only the tier in view stays pinned, on one line,
// « Tout écarter (n) » whole; the coach's suggestions keep to one row. At every width, the pinned header sticks to the very
// top of the page's scrolling column: no entry shows above it (the band under the page's top padding).
// Open, the panel is pinned under the Top Bar wherever the column is scrolled, over a scrim that a tap closes, the icon
// pressed; the column does not move.
const fr = JSON.parse(readFileSync("packages/shared/src/i18n/locales/fr.json", "utf8"));
const origin = process.env.E2E_WEB_ORIGIN!;
const databaseUrl = process.env.E2E_DATABASE_URL!;
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 375, height: 812 };
const LAPTOP = { width: 1280, height: 800 };
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.use({ baseURL: origin });

const masterCv = {
  fullName: "Inès Garnier",
  headline: "Responsable des achats",
  email: "ines.garnier@example.fr",
  phone: "",
  location: "Nantes",
  summary: "",
  experience: [{ title: "Responsable des achats", employer: "Atlantique Agro", location: "Nantes", period: "2014 – 2026", description: "Achats indirects." }],
  education: [],
  skills: ["Négociation", "SAP Ariba"],
  languages: [],
};

/**
 * A Candidate with two Profiles (two « Lancer une recherche » suggestions) and an Offer box: 3 entries arrived today, 12
 * arrived 3 days ago, by a Job Search or (one in three) an email. Returns how many are à traiter, and by email.
 */
async function candidateWithOfferBox(page: Page, label: string): Promise<{ toHandle: number; email: number }> {
  await signInWithMagicLink(page, newAddress(label));
  const candidateId = (await (await page.request.get("/api/auth/get-session")).json()).user.id as string;
  const created = await page.request.post("/api/profiles", { headers: { origin }, data: { masterCv, searchCriteria: { targetRole: "Acheteuse", locations: ["Nantes"] } } });
  expect(created.status(), await created.text()).toBe(201);
  const profile = (await created.json()).id as string;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  let email = 0;
  try {
    // A second Profile, past the free plan's one, for a second « Lancer une recherche ».
    await db.query(`INSERT INTO profile (candidate_id, name, target_role, locations) VALUES ($1, 'Responsable des achats indirects et de la sous-traitance', 'Responsable des achats', ARRAY['Nantes'])`, [candidateId]);
    const rows: Array<[string, number, string]> = [
      ...[0, 1, 2].map((n): [string, number, string] => [`today-${n}`, 0, "job_search"]),
      ...Array.from({ length: 12 }, (_, n): [string, number, string] => [`earlier-${n}`, 3, n % 3 === 0 ? "email" : "job_search"]),
    ];
    for (const [key, arrivedDaysAgo, source] of rows) {
      if (source === "email") email += 1;
      const offer = await db.query(
        `INSERT INTO job_offer (url_key, content_fingerprint, source_url, title, employer, location, content, posted_at) VALUES ($1, $1, $2, $3, 'Atlantique Agro', 'Nantes (44)', 'Un poste.', now() - make_interval(days => $4)) RETURNING id`,
        [`ph-${tag}-${label}-${key}`, `https://emploi-e2e.example/${tag}/${label}/${key}`, `Acheteuse ${key} ${tag}`, arrivedDaysAgo + 1],
      );
      await db.query(
        `INSERT INTO offer_box_entry (candidate_id, job_offer_id, profile_id, first_arrival_at, arrival_sources)
         VALUES ($1, $2, $3, now() - make_interval(days => $4), jsonb_build_object($5::text, to_char((now() - make_interval(days => $4)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`,
        [candidateId, offer.rows[0].id, profile, arrivedDaysAgo, source],
      );
    }
  } finally {
    await db.end();
  }
  return { toHandle: 15, email };
}

const topBarOf = (page: Page) => page.getByRole("banner");
const filterIconOf = (page: Page) => topBarOf(page).getByRole("button", { name: new RegExp(`^${fr.offerBox.filter}`) });
const boxOf = (page: Page) => page.getByRole("region", { name: /^Offres à traiter/ });
const dayOf = (page: Page, name: string) => boxOf(page).getByRole("region", { name, exact: true });
/** « Précédemment »'s last tier, and its entries. */
const LAST_EARLIER_TIER = "section.offer-box-day ~ section.offer-box-day .offer-box-tier:last-of-type";
/** The scrim under the open panel. */
const scrimOf = (page: Page) => page.locator(".offer-box-scrim");
const scrollTopOf = (page: Page) => page.locator("main").evaluate((main) => main.scrollTop);
/** `token`'s color, as the browser computes it, to compare with an element's. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
const filterName = (count: number, source: string) => fr.offerBox.filterName.replace("{{count}}", String(count)).replace("{{source}}", source);

/** The page's scrolling column, scrolled to `top` (px), then where its scrollport begins. */
async function scrollPage(page: Page, top: number): Promise<number> {
  return page.locator("main").evaluate((main, y) => {
    main.scrollTop = y;
    return main.getBoundingClientRect().top;
  }, top);
}

/** The column's scroll offset at which `selector`'s first element reaches its top, plus `more`. */
async function offsetOf(page: Page, selector: string, more = 0): Promise<number> {
  return page.locator("main").evaluate(
    (main, [css, extra]) => {
      const element = main.querySelector(css as string)!;
      return element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop + (extra as number);
    },
    [selector, more] as const,
  );
}

/** Entries whose visible part lies between the scrollport's top and `below` (px from the viewport's top). */
async function entriesAbove(page: Page, scrollportTop: number, below: number): Promise<string[]> {
  return page.locator(".offer-box-entry").evaluateAll(
    (entries, [top, bottom]) =>
      entries.filter((entry) => {
        const box = entry.getBoundingClientRect();
        return Math.min(box.bottom, bottom!) - Math.max(box.top, top!) > 0.5;
      }).map((entry) => entry.getAttribute("aria-label") ?? ""),
    [scrollportTop, below],
  );
}

test.describe("« Offres à traiter » on a phone (#898)", () => {
  test("in « Précédemment », only the tier stays pinned, on one line with « Tout écarter (n) », and the entries get at least 55 % of the screen", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await candidateWithOfferBox(page, "phone-room");
    await page.goto("/recherches");
    await expect(dayOf(page, fr.offerBox.earlier)).toBeVisible();

    // The header is behind the filter icon: not on the page; « Aujourd'hui » says the count instead, and scrolls away.
    await expect(boxOf(page).getByRole("progressbar")).toBeHidden();
    await expect(boxOf(page).getByRole("group", { name: fr.offerBox.chips })).toBeHidden();
    await expect(dayOf(page, fr.offerBox.today).getByText("3 arrivées aujourd'hui · 15 à traiter")).toBeVisible();

    // Well into « Précédemment ».
    const scrollportTop = await scrollPage(page, await offsetOf(page, `${LAST_EARLIER_TIER} .offer-box-entries`, 120));
    const pinned = await page.locator(".offer-box-tier-heading").evaluateAll(
      (headings, top) => headings.filter((heading) => Math.abs(heading.getBoundingClientRect().top - (top as number)) < 1).map((heading) => heading.textContent),
      scrollportTop,
    );
    expect(pinned, "one tier pinned at the top, named with its day").toEqual([expect.stringMatching(new RegExp(`^${fr.offerBox.earlier} · `))]);
    await expect(dayOf(page, fr.offerBox.earlier).getByRole("heading", { level: 3 })).not.toBeInViewport();

    const tier = page.locator(`${LAST_EARLIER_TIER} .offer-box-tier-heading`);
    const heading = (await tier.boundingBox())!;
    const dismissAll = tier.getByRole("button", { name: /^Tout écarter dans/ });
    await expect(dismissAll).toHaveText(/^Tout écarter \(\d+\)$/);
    const button = (await dismissAll.boundingBox())!;
    expect(button.x + button.width, "« Tout écarter (n) » whole, inside the screen").toBeLessThanOrEqual(PHONE.width);
    expect(heading.height, "on one line").toBeLessThanOrEqual(button.height + 12);
    expect(await dismissAll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    // The entries' room: from under the pinned tier to the box at the foot.
    const foot = (await page.locator(".page-conversation-foot").boundingBox())!;
    const room = foot.y - (heading.y + heading.height);
    expect(room / PHONE.height, `${Math.round(room)} px of ${PHONE.height}`).toBeGreaterThanOrEqual(0.55);
    expect(await entriesAbove(page, scrollportTop, heading.y)).toEqual([]);
  });

  test("the filter icon opens the header as a panel; a source chosen filters the box, closes it and leaves a dot on the icon; by keyboard and screen reader", async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { toHandle, email } = await candidateWithOfferBox(page, "phone-filter");
    await page.goto("/recherches");

    // The compact Top Bar shows the filter, « Activité » and « Effacer » under « … ».
    const icon = filterIconOf(page);
    await expect(icon).toHaveAccessibleName(filterName(toHandle, fr.offerBox.filterAll));
    await expect(icon).toHaveAttribute("title", fr.offerBox.filter);
    await expect(icon).toHaveAttribute("aria-expanded", "false");
    await topBarMoreOf(page).click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([fr.fiche.activity, fr.contextBar.clear]);
    await page.keyboard.press("Escape");

    // Enter opens the panel, the focus on the source chosen; Escape closes it, the focus back on the icon.
    await icon.focus();
    await page.keyboard.press("Enter");
    await expect(icon).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`[id="${await icon.getAttribute("aria-controls")}"]`);
    await expect(panel.getByRole("heading", { level: 2, name: fr.offerBox.title })).toBeVisible();
    await expect(panel.getByRole("progressbar")).toBeVisible();
    const chips = panel.getByRole("group", { name: fr.offerBox.chips });
    const all = chips.getByRole("button", { name: fr.offerBox.chipCount.replace("{{source}}", fr.offerBox.sources.all).replace("{{count}}", String(toHandle)) });
    await expect(all).toBeFocused();
    // Under the Top Bar, the chips on several lines, all within the screen.
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual((await topBarOf(page).boundingBox())!.y + (await topBarOf(page).boundingBox())!.height - 1);
    const chipBoxes = await chips.getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON() as DOMRect));
    expect(new Set(chipBoxes.map((box) => Math.round(box.top))).size).toBeGreaterThan(1);
    expect(Math.max(...chipBoxes.map((box) => box.right))).toBeLessThanOrEqual(PHONE.width);
    // As the prototype's « filtre ouvert »: the icon pressed, the entries dimmed under the panel.
    expect(await icon.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(await tokenColor(page, "--color-accent-soft"));
    expect(await icon.evaluate((button) => getComputedStyle(button).borderColor)).toBe(await tokenColor(page, "--color-accent"));
    expect(await icon.locator(".offer-box-filter-glyph").evaluate((glyph) => getComputedStyle(glyph).color)).toBe(await tokenColor(page, "--color-accent"));
    await expect(scrimOf(page)).toBeVisible();
    const axe = await new AxeBuilder({ page }).include(".topbar").include(".offer-box-head").analyze();
    expect(axe.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(icon).toHaveAttribute("aria-expanded", "false");
    await expect(icon).toBeFocused();
    await expect(chips).toBeHidden();
    await expect(scrimOf(page)).toHaveCount(0);
    expect(await icon.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

    // A source chosen with the keyboard: the box filtered, the panel closed, the focus back on the icon, which says so.
    await page.keyboard.press("Enter");
    const emailChip = chips.getByRole("button", { name: fr.offerBox.chipCount.replace("{{source}}", fr.offerBox.sources.email).replace("{{count}}", String(email)) });
    await emailChip.focus();
    await page.keyboard.press("Enter");
    await expect(icon).toHaveAttribute("aria-expanded", "false");
    await expect(icon).toBeFocused();
    await expect(icon).toHaveAccessibleName(filterName(toHandle, fr.offerBox.filterSource.replace("{{source}}", fr.offerBox.sources.email)));
    await expect(icon.locator(".offer-box-filter-dot")).toBeVisible();
    await expect(boxOf(page).locator(".offer-box-day .offer-box-entry")).toHaveCount(email);

    // « Toutes » again, with the pointer: no dot.
    await icon.click();
    await all.click();
    await expect(icon).toHaveAccessibleName(filterName(toHandle, fr.offerBox.filterAll));
    await expect(icon.locator(".offer-box-filter-dot")).toHaveCount(0);
    await expect(boxOf(page).locator(".offer-box-day .offer-box-entry")).toHaveCount(toHandle);
  });

  test("scrolled down to the conversation, the filter opens its panel in view under the Top Bar, over a scrim; the column neither scrolls nor moves, and a tap on the scrim closes it", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await candidateWithOfferBox(page, "phone-panel-anywhere");
    await page.goto("/recherches");
    await expect(dayOf(page, fr.offerBox.earlier)).toBeVisible();

    // The column scrolled to its end, the conversation: the box's top far above.
    const scrollportTop = await page.locator("main").evaluate((main) => {
      main.scrollTop = main.scrollHeight;
      return main.getBoundingClientRect().top;
    });
    await expect(page.locator(".page-conversation-foot")).toBeInViewport();
    const before = await scrollTopOf(page);
    expect((await boxOf(page).boundingBox())!.y, "the box's top above the screen").toBeLessThan(-PHONE.height);

    const icon = filterIconOf(page);
    await icon.click();
    const panel = page.locator(".offer-box-head[data-open]");
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expect(panel.getByRole("group", { name: fr.offerBox.chips })).toBeInViewport({ ratio: 1 });
    const top = (await panel.boundingBox())!.y;
    expect(Math.abs(top - scrollportTop), `the panel at ${top} px, under the Top Bar at ${scrollportTop} px`).toBeLessThanOrEqual(1);
    expect(await scrollTopOf(page), "opening it moves nothing").toBe(before);

    // The scrim under it: what is below is dimmed, takes no tap and does not scroll.
    const scrim = (await scrimOf(page).boundingBox())!;
    expect(scrim.y).toBeCloseTo(scrollportTop, 0);
    expect(scrim.y + scrim.height).toBeCloseTo(PHONE.height, 0);
    const below = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? "", [PHONE.width / 2, PHONE.height - 40]);
    expect(below).toBe("offer-box-scrim");
    await page.mouse.move(PHONE.width / 2, PHONE.height - 40);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(200);
    expect(await scrollTopOf(page), "the column does not scroll behind the scrim").toBe(before);

    // A tap on the scrim closes the panel, the focus back on the icon, the column where it was.
    await page.mouse.click(PHONE.width / 2, PHONE.height - 40);
    await expect(panel).toHaveCount(0);
    await expect(scrimOf(page)).toHaveCount(0);
    await expect(icon).toHaveAttribute("aria-expanded", "false");
    await expect(icon).toBeFocused();
    expect(await scrollTopOf(page), "closing it moves nothing").toBe(before);

    // By the keyboard too: Escape closes it, the column where it was.
    await page.keyboard.press("Enter");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(icon).toBeFocused();
    expect(await scrollTopOf(page)).toBe(before);
  });

  test("deep in « Précédemment », « Annuler » in the toast leaves the column where it was, the focus on the filter icon", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await candidateWithOfferBox(page, "phone-undo");
    await page.goto("/recherches");
    await expect(dayOf(page, fr.offerBox.earlier)).toBeVisible();

    await scrollPage(page, await offsetOf(page, `${LAST_EARLIER_TIER} .offer-box-entries`, 120));
    const line = page.locator(`${LAST_EARLIER_TIER} .offer-box-entry`).last();
    const title = (await line.getAttribute("aria-label"))!;
    await line.getByRole("button", { name: fr.offerBox.dismiss, exact: true }).click();
    await line.getByRole("button", { name: fr.offerBox.dismissWithoutReason }).click();
    const undo = page.getByRole("status").getByRole("button", { name: fr.offerBox.undo });
    await expect(undo).toBeFocused();
    const before = await page.locator("main").evaluate((main) => main.scrollTop);
    expect(before, "well into « Précédemment »").toBeGreaterThan(PHONE.height);

    // The box's heading is hidden at the top of the box: the focus on it would scroll the column back up there.
    await page.keyboard.press("Enter");
    await expect(undo).toBeHidden();
    await expect(dayOf(page, fr.offerBox.earlier).getByRole("listitem", { name: title })).toBeVisible();
    const after = await page.locator("main").evaluate((main) => main.scrollTop);
    expect(Math.abs(after - before), `scrolled from ${before} to ${after} px`).toBeLessThan(PHONE.height / 2);
    await expect(filterIconOf(page)).toBeFocused();
  });

  test("the coach's suggestions keep to one row, and nothing scrolls the page sideways at 375 px, the panel open or not", async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    await candidateWithOfferBox(page, "phone-width");
    await page.goto("/recherches");

    const suggestions = page.locator(".page-conversation-suggestions").getByRole("button");
    await expect(suggestions).toHaveCount(2);
    const tops = await suggestions.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(tops).size, "one row").toBe(1);

    const sideways = () =>
      page.evaluate(() => {
        const main = document.querySelector("main")!;
        return { document: document.documentElement.scrollWidth, page: main.scrollWidth - main.clientWidth };
      });
    expect(await sideways()).toEqual({ document: SMALL_PHONE.width, page: 0 });
    await scrollPage(page, await offsetOf(page, `${LAST_EARLIER_TIER} .offer-box-entries`, 120));
    expect(await sideways()).toEqual({ document: SMALL_PHONE.width, page: 0 });
    await filterIconOf(page).click();
    await expect(page.locator(".offer-box-head[data-open]")).toBeVisible();
    expect(await sideways()).toEqual({ document: SMALL_PHONE.width, page: 0 });
  });
});

test.describe("« Offres à traiter »'s pinned header (#898)", () => {
  test("sticks to the very top of the page's column, with no entry showing above it, at 1280 and at 390 px", async ({ page }) => {
    await candidateWithOfferBox(page, "pinned-top");

    // A laptop: the header pinned, the scrollport's top its own.
    await page.setViewportSize(LAPTOP);
    await page.goto("/recherches");
    await expect(dayOf(page, fr.offerBox.earlier)).toBeVisible();
    for (const y of [200, 600, 1000]) {
      const scrollportTop = await scrollPage(page, y);
      const head = (await boxOf(page).locator(".offer-box-head").boundingBox())!;
      expect(Math.abs(head.y - scrollportTop), `scrolled ${y} px: the header at the column's top`).toBeLessThanOrEqual(0.5);
      expect(await entriesAbove(page, scrollportTop, head.y)).toEqual([]);
    }

    // A phone: the tier pinned, the same.
    await page.setViewportSize(PHONE);
    await page.reload();
    await expect(dayOf(page, fr.offerBox.earlier)).toBeVisible();
    for (const [selector, more] of [
      [".offer-box-day .offer-box-entries", 80],
      ["section.offer-box-day ~ section.offer-box-day .offer-box-entries", 80],
      ["section.offer-box-day ~ section.offer-box-day .offer-box-entries", 900],
    ] as const) {
      const scrollportTop = await scrollPage(page, await offsetOf(page, selector, more));
      const top = await page.evaluate((y) => document.elementFromPoint(195, y + 1)?.closest(".offer-box-tier-heading, .offer-box-entry")?.className ?? "", scrollportTop);
      expect(top, `${selector}: a tier's heading at the column's top`).toContain("offer-box-tier-heading");
      const heading = await page.evaluate((y) => document.elementFromPoint(195, y + 1)!.closest(".offer-box-tier-heading")!.getBoundingClientRect().top, scrollportTop);
      expect(Math.abs(heading - scrollportTop), `${selector}: the tier at the column's top`).toBeLessThanOrEqual(0.5);
      expect(await entriesAbove(page, scrollportTop, heading)).toEqual([]);
    }
  });
});
