import { AxeBuilder as PlaywrightAxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** A reply whose words are still coming one by one (#788): `.chat-revealing` until its last word and what follows it are in. */
const REVEALING = ".chat-revealing";

/**
 * axe on the page at rest (#788). A reply just arrived shows its words one by one, each fading in; a word still fading in
 * is drawn at part of its opacity, and axe scores its contrast so, as too faint. `analyze` therefore waits until no reply
 * is still revealing, then runs axe as `@axe-core/playwright`'s AxeBuilder does, every rule as strict. On a page with no
 * reply coming in, it runs at once. A spec showing a conversation imports this one in its place.
 */
export default class AxeBuilder extends PlaywrightAxeBuilder {
  readonly #page: Page;

  constructor(params: ConstructorParameters<typeof PlaywrightAxeBuilder>[0]) {
    super(params);
    this.#page = params.page;
  }

  override async analyze(): ReturnType<PlaywrightAxeBuilder["analyze"]> {
    await expect(this.#page.locator(REVEALING), "a reply's words all in before axe scores them").toHaveCount(0, { timeout: 15_000 });
    return super.analyze();
  }
}
