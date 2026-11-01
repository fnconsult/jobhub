# Screenshot baselines

The screenshot specs (`toHaveScreenshot`, first `e2e/design-system-page.spec.ts`, #463) compare screens with PNG baselines kept in `e2e/__screenshots__/<spec>/`. CI's `screenshots` job runs them in the Playwright image (`mcr.microsoft.com/playwright`, the version the repo pins) and fails when a screen differs from its baseline by more than 0.2 % of its pixels (`playwright.config.ts`). Each also runs axe, there and with the rest of the e2e suite.

The baselines are drawn in that same image, so its fonts match. Elsewhere fonts render differently, on another Linux machine too (a Chromium outside the image may draw text in grayscale where the baselines have colour fringes), so a run on your machine checks axe and skips the comparison (`e2e/support/screenshots.ts`; `E2E_SCREENSHOTS=1` forces it, and a browser in the Playwright container through `PW_TEST_CONNECT_WS_ENDPOINT` compares). Every spec with a `toHaveScreenshot` asks that module whether to compare, never the platform alone: `e2e/support/screenshots.test.ts` fails otherwise. The emails' baselines (`e2e/email-html.spec.ts`, #472) follow the same rule for their `-linux` PNGs, compared in the `screenshots` job's `emails` project; their `-darwin` ones are compared on a Mac.

## Update a baseline on purpose

When a change is meant to alter how a screen looks (a token, a component, a screen migrated to the Design System):

1. Run `scripts/update-screenshot-baselines.sh`. It needs Docker with about 4 GB of memory, for `next build` (Colima's default 2 GB is too little: `colima start --memory 4`). It draws every baseline again in the Playwright image CI uses, from your working tree (uncommitted changes included). Name a spec to redraw only its baselines: `scripts/update-screenshot-baselines.sh e2e/design-system-page.spec.ts`.
2. Open the changed PNGs (`git status e2e/__screenshots__`) and check that every difference is one you meant, in light and dark, Confort and Compact, and at each width.
3. Commit them with the change that caused them, and say in the commit or PR why the screen changed.

Never update a baseline to make a failing CI run pass without looking at the difference. A failing comparison writes the expected, actual and diff images to `test-results/`; CI keeps that folder as the `screenshots` job's `screenshot-results` artifact.

## Add a screen

When a ticket migrates a key screen, add a spec that signs in as needed, sets each width from `SCREENSHOT_WIDTHS`, runs axe and calls `toHaveScreenshot` with a name of its own. Mask what changes from run to run (a date, a count) with locators inside the screenshot's target (`target.getByText(…)`, not `page.getByText(…)`): Playwright paints a mask over its element even where something covers it, so a page-wide mask under a sticky component (the Profile's save bar over a dated line, #511) leaks into that component's screenshot. A mask hides a text, not its width: in a table, a date of the day the suite runs still sizes the columns around it, so set it to the day the baselines were drawn before the shot (the Playbooks section of `e2e/back-office-sections-screenshots.spec.ts`). Then draw its baselines with the script above and commit them.
