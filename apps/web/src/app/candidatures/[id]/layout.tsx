import type { Metadata } from "next";
import type { ReactNode } from "react";
import { tailoredDocumentsMade, type Made } from "@/ai-activity";
import { loadAiActivity } from "@/ai-activity/server";
import { dossierSites } from "@/company-dossiers";
import { ABANDON_CARD } from "@/follow-ups";
import "./application.css";
import { ApplicationConversation } from "./conversation";
import { loadApplicationPage, type Params } from "./sections";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { application, t } = await loadApplicationPage((await params).id);
  return { title: `${application.jobOffer.title} · ${t("app.name")}` };
}

/**
 * One Application: its conversation, with its Fiche (#603, ADR-0070; see ApplicationConversation). Its Sections
 * (ADR-0024), each at its own address, open in the Work Pane: the AI Coach's Action Cards, the Tailored Documents, the
 * Match Score's breakdown, the Interviews, the Human Coaches' Coach Reviews, the Company Dossier, its Enriched Contacts
 * (when a contact-data provider is on) and the full Job Offer.
 */
export default async function ApplicationLayout({ params, children }: Params & { children: ReactNode }) {
  const data = await loadApplicationPage((await params).id);
  const { candidateId, application, shownCards, companyDossier, tailoredCv, drafts } = data;
  // What AI made for the Application: the Tailored CV and Documents (#334), the Action Cards (#336) and the Company Dossier
  // (#335; one built before shows « modèle non enregistré » with the sites its source names) with their Provenance. An
  // « Abandonnée » suggestion is worded by Jobbbox, no AI: not listed.
  const made: Made[] = [
    ...tailoredDocumentsMade(tailoredCv, drafts),
    ...(companyDossier?.status === "built"
      ? [
          {
            kind: "company_dossier" as const,
            at: companyDossier.dossier.builtAt,
            provenance: companyDossier.provenance ?? null,
            ...(companyDossier.provenance ? {} : { sites: dossierSites(companyDossier.dossier) }),
          },
        ]
      : []),
    ...shownCards
      .filter((card) => card.kind !== ABANDON_CARD)
      .map((card) => ({ kind: "action_card" as const, name: card.title, at: card.createdAt, provenance: card.provenance })),
  ];
  const aiActivity = await loadAiActivity.application(candidateId, { id: application.id, jobOffer: { id: application.jobOffer.id, title: application.jobOffer.title } }, made);
  return (
    <ApplicationConversation data={data} aiActivity={aiActivity}>
      {children}
    </ApplicationConversation>
  );
}
