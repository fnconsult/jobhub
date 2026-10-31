# The conversation is the page: one Coach Conversation per Subject, columns beside it

Status: accepted (map #585; tickets #586, #588, #590)

On the Candidate's pages, the conversation with the AI Coach is no longer a side panel opened by « Aide et coach »: it is the page. This changes how every Candidate page is built and how Coach Conversations are stored, so it is costly to undo.

- **Every page is a Coach Conversation with a Subject.** An Application, a Profile, a Job Search and a Job Digest each have at most one; so does each Sidebar menu (Mes candidatures, Recherches d'offres, Job Digests, Agenda, Mes coachs humains), one per Candidate. « Coach » in the Sidebar starts Free conversations. A conversation is created at its first message; an archived object keeps it. The box sits at the foot of the page, as in an agent harness.
- **The home page and the menus are conversations**: their content (the list of Applications, the tagline, the quick actions) becomes a card in the thread or suggestions above the box.
- **An object's page puts columns beside the conversation, never over it**: the Fiche (the object, then its Sections, Activity and Results, each group foldable), and the Work Pane where a Result, a Section, a Help Article or a form opens to be acted on. The Top Bar's « Fiche » and « Activité » buttons alone open and close the columns; the Work Pane closes with its ✕ and shows one item at a time. The conversation keeps its reading width, centred in its space; columns are separated by a 1rem gutter, not lines. Where the Fiche and the Work Pane together would leave the conversation under 28rem (below 100rem with the Sidebar open, 76.5rem without), the Work Pane takes the Fiche's place until it closes.
- **The Coach Panel leaves the Candidate's pages.** Help Articles suggested while typing stay above the box; a Help Article opens in the Work Pane; « Cela répond à votre question ? » stays under each reply; Signalement links stay under the box and their form opens in the Work Pane; Coach Memory moves under « Coach » in the Sidebar. Pages without a conversation (Mon compte) get an « Aide » button in the Top Bar.
- **Activity shows a Context bar**: messages out of the 40 the AI Coach reads and jetons out of the context ceiling, with « Effacer la conversation » offered from 80 %.
- **« Effacer »**, after a confirming Dialog, deletes every message of the page's conversation; the object and Coach Memory stay.
- **The Back Office Assistant keeps its side panel**; the Back Office, the Coach space and the extension are unchanged.
- **Existing Coach Conversations are deleted** when this ships: they were attached to a Profile with mixed Focus, and only staging holds them.

This amends ADR-0053 (the Top Bar no longer carries « Aide et coach »; the Coach Panel is the Back Office's only) and ADR-0057 (on Candidate pages a form opens in the Work Pane, not a Drawer; the Dialog still only confirms).

## Considered Options

The prototype (branch `prototype/conversation-au-centre`, never merged) compared:

- **The object as the first card of the thread, panes floating over it**: panes covered the conversation.
- **Page and conversation side by side with a movable divider**: the page stayed first and the coach second.
- **Tabs on the object, « Conversation » by default**: hid the object while talking about it.
- **Tabs inside the side panes** and a **« Document » button**: duplicated the Top Bar, and the button had no single target once an object has several Results.
- **Splitting existing conversations by Focus**: would cut exchanges in the middle; deleting them was possible because no real Candidate has any yet.
