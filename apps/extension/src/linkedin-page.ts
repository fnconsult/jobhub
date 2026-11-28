/**
 * Reading a LinkedIn page the Candidate opened (ADR-0119 « LinkedIn, through the extension only », #1164), in their own
 * browser and on their click on « Lire cette page LinkedIn »: a Job Offer, a company page, or a company's people filtered
 * by department. `readLinkedInPage(document)` is the whole interface: the Reading of the page, or null when it is not one
 * a Reading may be of (a person's profile never is) or its company cannot be told.
 *
 * Of each person it reads their name and role from the card LinkedIn draws, and gives them the page's company; it reads
 * no profile address, photo, place or degree of connection, and the Reading is cut to its fields by `linkedInReadingOf`.
 * Nothing runs in the background: the Side Panel injects this, once, into the page in view (activeTab).
 */
import { linkedInPageOf, linkedInReadingOf, type LinkedInReading } from "@jobhub/shared";

/** The company the page is about: a company page's title, or a posting's employer in its top card. */
const COMPANY_NAME = [
  ".org-top-card-summary__title",
  ".job-details-jobs-unified-top-card__company-name",
  ".jobs-unified-top-card__company-name",
  ".org-top-card h1",
];
/** A person's card: one of a company's people, or a posting's hiring team. */
const PERSON_CARD = ".org-people-profile-card, .hirer-card__hirer-information";
const PERSON_NAME = [".artdeco-entity-lockup__title", ".jobs-poster__name"];
const PERSON_ROLE = [".artdeco-entity-lockup__subtitle", ".hirer-card__hirer-job-title"];
/** The department a company's people are filtered by: the selected bar of « Où ils travaillent ». */
const DEPARTMENT = ".org-people-bar-graph-element--is-selected .org-people-bar-graph-element__category, .org-people-bar-graph-element[aria-pressed='true'] .org-people-bar-graph-element__category";

/** An element's text as the person reads it: the screen reader's hidden words (« Voir le profil de… ») left out. */
function shownText(element: Element | null | undefined): string {
  if (!element) return "";
  const visible = element.querySelector("[aria-hidden='true']");
  const copy = (visible ?? element).cloneNode(true) as Element;
  copy.querySelectorAll(".visually-hidden, .sr-only").forEach((node) => node.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

const firstText = (root: ParentNode, selectors: readonly string[]) => {
  for (const selector of selectors) {
    const text = shownText(root.querySelector(selector));
    if (text) return text;
  }
  return "";
};

export function readLinkedInPage(document: Document): LinkedInReading | null {
  const page = linkedInPageOf(document.location.href);
  if (!page) return null;
  const main = document.querySelector("main") ?? document.body;
  const company = firstText(main, COMPANY_NAME);
  const people = [...main.querySelectorAll(PERSON_CARD)].map((card) => ({ name: firstText(card, PERSON_NAME), role: firstText(card, PERSON_ROLE), company }));
  const department = page.kind === "people" ? shownText(main.querySelector(DEPARTMENT)) : "";
  return linkedInReadingOf({ page, company, ...(department ? { department } : {}), people });
}
