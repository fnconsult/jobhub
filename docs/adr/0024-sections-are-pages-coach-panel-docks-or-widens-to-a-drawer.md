# Long pages split into Sections with their own address; the Coach Panel docks beside the page or widens into a drawer

Pages in the sidebar layout had grown into long stacks of headings (Mon compte held nine), in a 44rem column centred in a wide screen, while the Coach Panel spent a third of its height on tool buttons and context. We decided (with the prototype on branch `prototype/coach-panel-variants`) that the page's space goes to the content and the panel's space goes to the conversation:

- **Sections, each with its own address.** A long page is split into Sections. On wide screens the page lists its Sections beside the content and shows one at a time; on phones the list is the page and each Section opens as a full-height drawer with a Retour button. Each Section is a real URL rendered as a page (not a modal over the list), so the back button, links, reloads and screen readers behave as on any other page (ADR-0009). This holds for every page with several Sections, not just Mon compte.
- **The page's title lives in the Top Bar**, so the bar is never empty and the page gains height. Signing out moves to the Sidebar's foot. The content column is wide (up to 72rem, aligned beside the Sidebar), and running text stays at a readable measure.
- **The Coach Panel docks beside the page from 64rem**, with the page scrolling in its own column so its scrollbar never lands on the panel. Its one menu is the conversation's title (new conversation, saved Coach Conversations, Coach Memory); the Send button sits inside the message box; what the coach has in view is one line under the box. The Top Bar's coach button is hidden while the panel is open. **Agrandir** widens the panel into a modal drawer over the page (Escape or the scrim bring it back beside the page; Fermer closes it), never remembered. The Back Office Assistant is the same panel.

## Considered Options

- **Tabs or anchors on one long page** for Sections: no URL per Section, and a senior audience loses its place on a page whose content swaps without the address changing.
- **A real modal drawer over the Section list on phones**: two layers of focus and history to get right for no gain over a page styled as a sheet.
- **Panel overlay below 80rem** (as before): it covered the page without a scrim, and the page's content under it stayed clickable.
- **A permanent conversation list beside the chat** (prototype variant C): it needs half the window, and saved conversations are opened rarely.

## Consequences

- Dark mode stays out: the tokens are light only, and a dark set is its own pass, audited like the light one.
- Every page that renders its own `<h1>` hands it to the layout instead.
- Split so far: Mon compte, a Profile's page and an Application's page. A page's own address shows its first Section; a Section that is absent (no Action Cards, no Job Digest, no coach review…) is left out of the list. Propositions comes first when there are Action Cards, so they are what a Candidate sees on arriving; computing an ATS Score leads to them.
- The Subscription is one of Mon compte's Sections but keeps its address (/abonnement), which Stripe and shared promotion links lead to, and stays whole: its notices and codes go from the address into the Plans table on the same page. The Human Coaches page stays whole too, for the same reason. Mon compte itself moves to the Sidebar's foot, above signing out.
- On a phone, a Section shown alone has no back link of its own: the Top Bar's title is the way back, behind an arrow, as on iOS.
- With the Coach Panel docked, a column too narrow for its Sections' list hands the list to the Sidebar, in place of the main menu, which stays one arrow away (« Menu principal »); with the Sidebar hidden, the list lines up above the Section shown.
- The selected item of a menu is bold and shaded, without the accent bar it used to have.
