import type { Metadata } from "next";
import { loadAiActivity } from "@/ai-activity/server";
import { getCurrentCandidate, signInRedirect } from "@/auth/server";
import { AgendaMenuPage } from "@/components/AgendaMenuPage";
import { CandidateLayout } from "@/components/CandidateLayout";
import { getServerT } from "@/i18n/server";

type SearchParams = { vue?: string | string[]; date?: string | string[]; periode?: string | string[]; ajouter?: string | string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: `${t("agenda.title")} · ${t("app.name")}` };
}

/**
 * The Agenda (« Entretiens et rendez-vous »): the Candidate's Agenda Items as a
 * list (the default), a week or a month, each view and period with its own
 * address (ADR-0028), the last view picked remembered in the browser.
 *  - The list: upcoming ones grouped by day in French time, oldest first;
 *    « Voir les rendez-vous passés » shows the past ones instead, newest first.
 *  - The week: Monday to Sunday, one column per day (stacked on phones), each
 *    listing its items with their time.
 *  - The month: a grid of days with a marker per item; choosing a day lists its
 *    items below the grid.
 * Past items are dimmed. An Interview leads to its Application's Interviews
 * Section, a Coaching Session to its Human Coach on the Human Coaches page.
 * Unscheduled Coaching Sessions sit at the top, « À planifier », with each Human
 * Coach's booking link and the cancellation of one dated before, and in no view.
 * In every view, a Cancelled Interview stays, struck through, with its date of
 * cancellation; a Rescheduled item says when it was first planned, with an
 * « Historique » of every change; a dated Coaching Session can be cancelled.
 * The AI Coach has the Agenda In view: its Agenda Items of the next 30 days.
 * Under « Conversation au centre » (#606, ADR-0070), the menu's conversation is the page instead, the list a card in its
 * thread, the week, the month and the form adding an Interview in the Work Pane (see AgendaMenuPage).
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const candidate = await getCurrentCandidate();
  if (!candidate) return signInRedirect();
  const params = await searchParams;
  const [t, aiActivity] = await Promise.all([getServerT(), loadAiActivity.agenda(candidate.id)]);
  return (
    <CandidateLayout candidateId={candidate.id} title={t("agenda.title")} aiActivity={aiActivity}>
      <AgendaMenuPage candidateId={candidate.id} params={params} />
    </CandidateLayout>
  );
}

