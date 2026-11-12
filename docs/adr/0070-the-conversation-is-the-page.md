# The conversation is the page: one Coach Conversation per Subject, columns beside it

Status: accepted (map #585; tickets #586, #588, #590, #608)

On the Candidate's pages, the conversation with the AI Coach is no longer a side panel opened by « Aide et coach »: it is the page. This changes how every Candidate page is built and how Coach Conversations are stored, so it is costly to undo.

- **Every page is a Coach Conversation with a Subject.** An Application, a Profile, a Job Search and a Job Digest each have at most one; so does each Sidebar menu (Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains), one per Candidate. « Coach » in the Sidebar starts Free conversations. A conversation is created at its first message; an archived object keeps it. The box sits at the foot of the page, as in an agent harness.
- **The home page and the menus are conversations**: their content (the list of Applications, the tagline, the quick actions) becomes a card in the thread or suggestions above the box.
- **An object's page puts columns beside the conversation, never over it, on a wide screen**: the Fiche (the object, then its Sections, Activity and Results, each group foldable), and the Work Pane where a Result, a Section, a Help Article or a form opens to be acted on. The Top Bar's « Fiche » and « Activité » buttons alone open and close the columns; the Work Pane closes with its ✕ and shows one item at a time. The conversation keeps its reading width, centred in its space; columns are separated by a 1rem gutter, not lines. Where the Fiche and the Work Pane together would leave the conversation under 28rem (below 100rem with the Sidebar open, 76.5rem without), the Work Pane takes the Fiche's place until it closes; « Fiche » or « Activité » pressed meanwhile closes it and brings the Fiche back.
- **On a phone (below 64rem) the conversation takes the whole screen**, and the Fiche, the Activité column and the Work Pane open over it, full screen, with a title and a ✕ « Fermer » (Escape too); focus returns to the Top Bar button. While one covers the page, the Top Bar and the conversation are inert. The Sidebar stays a drawer.
- **The Coach Panel leaves the Candidate's pages.** Help Articles suggested while typing stay above the box; a Help Article opens in the Work Pane; « Cela répond à votre question ? » stays under each reply; Signalement links stay under the box and their form opens in the Work Pane; Coach Memory moves under « Coach » in the Sidebar. Pages without a conversation (Mon compte) get an « Aide » button in the Top Bar.
- **Activity shows a Context bar**: messages out of the 40 the AI Coach reads and jetons out of the context ceiling, with « Effacer la conversation » offered from 80 %. The bar measures what was sent for the AI Coach's latest reply, kept with it, rather than a fresh estimate when the page loads, so showing it needs no AI and no extra workspace reads. Where there is no object (home page, menus), « Activité » alone opens an Activité column holding it.
- **« Effacer »**, after a confirming Dialog, deletes every message of the page's conversation; the object and Coach Memory stay.
- **The Back Office Assistant keeps its side panel**; the Back Office and the extension are unchanged, and the Coach space loses the Coach Panel's floating button (the Coach Panel is the Back Office's alone).
- **The switch is gone**: `CONVERSATION_FIRST` is removed (#608); every Candidate page is its conversation.
- **Existing Coach Conversations are deleted** when this ships: they were attached to a Profile with mixed Focus, and only staging holds them.

This amends ADR-0053 (the Top Bar no longer carries « Aide et coach »; the Coach Panel is the Back Office's only) and ADR-0057 (on Candidate pages a form opens in the Work Pane, not a Drawer; the Dialog still only confirms).

## Considered Options

The prototype (branch `prototype/conversation-au-centre`, never merged) compared:

- **The object as the first card of the thread, panes floating over it**: panes covered the conversation.
- **Page and conversation side by side with a movable divider**: the page stayed first and the coach second.
- **Tabs on the object, « Conversation » by default**: hid the object while talking about it.
- **Tabs inside the side panes** and a **« Document » button**: duplicated the Top Bar, and the button had no single target once an object has several Results.
- **Splitting existing conversations by Focus**: would cut exchanges in the middle; deleting them was possible because no real Candidate has any yet.

## Amended by ADR-0076: the same rules in the native app, on its window (2026-11-04)

The app applies these rules to the window's width in rem (16 pt times the system text scale), computed again on rotation, Split View, Stage Manager and foldables. From 64rem, the Fiche, the Activité column and the Work Pane are columns beside the conversation, as here. Below 64rem they open full screen over the page, the Top Bar included, with their title and « Fermer », as on the web phone; the Work Pane opens over the Fiche and closing it returns there. Sheets with two detents were prototyped and not kept. The Sidebar is a drawer on a phone and a column when the conversation keeps 28rem (the prototype's variant A, `prototype/mobile-shell`).


## Amendment of 2026-11-12: one side panel, its views' icons in the Top Bar (#980)

The product owner circled the Fiche's « Activité » group and moved it out of the Fiche, then chose, over three prototypes (https://claude.ai/artifact/XcpWuBZeybrk69kP2f8y8r: three columns, Activity inside the conversation, then this), the side panel of an agent harness such as the Claude Code app.

- **One side panel beside the conversation, never over it, showing one view at a time.** On an object's page its views are « Activité » (ADR-0086), « Fiche » (the object's card and its Sections, no longer foldable groups), « L'offre » for an Application (its Job Offer, the Section « L'offre » it replaces in the list keeping its address) and its Results, « Documents » (« Offres trouvées » for a Job Search or a Job Digest); « Activité » shows the latest three Results with « Tout voir ». On the home page and the menus it has « Activité » alone: the Activité column is this panel.
- **The Top Bar's « Fiche », « Activité » and « Effacer » give way to the panel's icons**, one per view, in that order, AI Activity's first (#809): an icon alone, named by its view, its tooltip saying it; the one shown pressed; its icon again closes the panel. While the panel is open beside the conversation, « … » beside them offers « Largeur du volet par défaut » and « Fermer le volet ». Alt+Shift and a view's letter (A, F, O, D) do what its icon does. « Effacer la conversation » becomes a link in the Context bar (ADR-0078 amendment).
- **The panel's head names its view and has ✕ « Fermer le volet »**, beside the conversation too; on a phone it is the title that takes the focus, as before.
- **Unchanged**: it opens on « Fiche » when an object's page loads on a wide screen and is closed on a narrower one or without an object; it gives way to the Work Pane where both would leave the conversation under 28rem, and an icon brings it back; its left edge resizes it (#932); below 64rem it opens full screen over the page. The compact Top Bar (ADR-0101) offers each view as an action, « Fiche » shown first while no AI action runs, and keeps « Effacer la conversation » under « … », so each page's « … » has its menu from the first paint.

The three columns of the first prototype were turned down by the product owner, who then asked for Activity « always part (or floating) of the conversation », and turned that down in turn for this panel.
