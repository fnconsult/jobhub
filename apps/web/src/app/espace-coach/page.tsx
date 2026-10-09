import type { Metadata } from "next";
import Link from "next/link";
import { CoachSpaceHeader } from "@/components/CoachSpaceHeader";
import { getHumanCoaches, requireHumanCoach } from "@/human-coaches/server";
import { getServerT } from "@/i18n/server";
import { routes } from "@/routes";

export async function generateMetadata(): Promise<Metadata> {
  await requireHumanCoach();
  const t = await getServerT();
  return { title: `${t("coachSpace.title")} · ${t("app.name")}`, robots: { index: false } };
}

/** A Human Coach's home: the Candidates who granted them Coach Access. */
export default async function CoachSpacePage() {
  const coach = await requireHumanCoach();
  const t = await getServerT();
  const candidates = await getHumanCoaches().candidates(coach.id);
  return (
    <main className="page">
      <CoachSpaceHeader />
      <h1>{t("coachSpace.title")}</h1>
      <p className="lead">{t("coachSpace.intro")}</p>
      {candidates.length === 0 ? (
        <p>{t("coachSpace.none")}</p>
      ) : (
        <ul>
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <Link href={routes.coachSpaceCandidate(candidate.id)}>{candidate.name ? `${candidate.name} (${candidate.email})` : candidate.email}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
