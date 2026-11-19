# « Pour bien commencer » lists what a new account has not used, and the extension counts as published while its store URL is set

#1069 adds a « Pour bien commencer » group to the empty Coach Conversation's help (Coach Panel on the web, Help in the apps), above « Souvent demandé », for the 14 days after the account is created. Two things needed a rule that the code now follows.

- **A feature counts as used when the account has an ATS Score on any of its profiles, or a Capture from the extension**: an Extension Event `capture`, or an Offer box entry whose Arrival source is « Extension ». The item leaves the list at once; nothing is stored about the list itself, so the privacy register has no entry.
- **The extension counts as published while `EXTENSION_STORE_URL` is set**, the same test as Mon compte › Outils. While it is empty no Candidate is led to a store page that does not exist. The item also needs a Chromium browser on a computer (Chrome, Edge, Brave; not Opera, Firefox, Safari, phones or tablets), and the apps never show it.
- **The section shows in every empty conversation**, including on pages with their own suggestions, where « Souvent demandé » is hidden: restricting it to pages without suggestions would almost never reach a new account.
- **The web reads the account when a page loads**: after an ATS Score or a Capture the item leaves on the next full page load, not during in-app navigation.

## Considered Options

- **A checklist with a stored « done » state per item**: one more thing to keep in step with the data that already says whether a feature was used.
- **Only Chrome and Edge for the extension**: safer, but the Chrome Web Store installs on other Chromium browsers and the issue allowed them.
