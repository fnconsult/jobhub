import { requireCoachSpaceV2 } from "@/coach-space-v2/server";
import Link from "next/link";
import { CoachSpaceShell } from "@/components/CoachSpaceHeader";
import { CalledBy } from "@/components/CalledBy";
import { requireCoachSpace } from "@/coach-space/server";
import { getCoachWorkspace } from "@/coach-space/workspace-server";
import { coachCandidateUrl } from "@/coach-space/SessionCard";
import { getServerT } from "@/i18n/server";
export default async function Page() {
  requireCoachSpaceV2(); // « Espace coach v2 » off (ADR-0106): a 404.
  const coach = await requireCoachSpace();
  const t = await getServerT();
  const candidates = await getCoachWorkspace().candidates(coach.id);
  return (
    <CoachSpaceShell>
      <section className="coach-space-card">
        <h2>{t("coachSpaceV2.pages.candidates")}</h2>
        {candidates.length ? (
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <Link href={coachCandidateUrl(candidate.id)}>{candidate.name || t("coachSpace.unnamedCandidate")}</Link>
                <CalledBy name={candidate.calledBy} t={t} />
                <p>{t(candidate.access ? "coachWorkspace.access" : "coachWorkspace.noAccess")}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("coachSpaceV2.empty.candidates")}</p>
        )}
      </section>
    </CoachSpaceShell>
  );
}
