# Screenshot comparisons run only in the pinned Playwright image

Status: accepted (#463)

The Design System page is the first screen compared with reference images (Screenshot baselines). Fonts and anti-aliasing differ between a developer's Mac and Linux, so the same page never gives identical pixels in both.

- **Baselines are drawn and compared in one place**: the Playwright image (`mcr.microsoft.com/playwright:v1.63.0-noble`). CI's `screenshots` job runs there and first checks that the lockfile pins the same `@playwright/test` version.
- **Elsewhere the comparison is skipped**, not loosened: a run on a developer machine still runs axe. `E2E_SCREENSHOTS=1` forces it, `E2E_SCREENSHOTS=0` (the main e2e run) turns it off.
- **Baselines change only on purpose**, with `scripts/update-screenshot-baselines.sh`, reviewed in the PR.

Alternatives not taken: a large pixel tolerance (hides real changes) and per-OS baselines (twice the images, drifting apart).
