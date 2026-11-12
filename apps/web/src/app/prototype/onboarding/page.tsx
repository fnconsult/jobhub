import type { Metadata } from "next";
import { OnboardingPrototype } from "./OnboardingPrototype";
import { STATES, type State } from "./states";

export const metadata: Metadata = { title: "Prototype · Créer un profil · Jobbbox" };

/**
 * THROWAWAY prototype (#995, never merged): three states of /profils/nouveau under « Conversation au centre » (ADR-0070),
 * with static fake data and no sign-in. `?etat=construction|resume|modification|recherche|offres`.
 */
export default async function OnboardingPrototypePage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  const { etat } = await searchParams;
  const state: State = (STATES as readonly string[]).includes(etat ?? "") ? (etat as State) : "construction";
  return <OnboardingPrototype state={state} />;
}
