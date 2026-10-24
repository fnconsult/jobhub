# A HelpTerm is a button on the first mention of a term per page only

Glossary terms in Candidate pages (#343) open their Help Article in the Coach panel. We decided that only the first mention of a term on a page is a button; later mentions are plain text. The choice is made while rendering, by pathname, so the server and the browser agree. A term is never placed in a Section's heading, which is visually hidden (the Top Bar says it): the button would be an invisible focus stop.

## Considered Options

- **Every mention is a button**: many identical focus stops and underlines on a page, noisy for a keyboard or screen-reader user.
- **A help icon beside each term**: an extra small target, and ADR-0009 sets a 44px floor.

## Consequences

- A term in a sentence is an inline target (WCAG 2.5.8 inline exception), exempt from the 44px floor of ADR-0009; the contrast (4.5:1 text, 6.2:1 underline) and the visible focus outline still apply.
- If the first mention unmounts while the page stays, later mentions stay plain text until they render again.
- A sidebar and the main content share a page, so a term in both counts once.
