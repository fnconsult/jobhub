import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CoachReviewList } from "@/components/CoachReviewList";
import { CoachSpaceHeader } from "@/components/CoachSpaceHeader";
import { JobOfferView } from "@/components/JobOfferView";
import { MasterCvView } from "@/components/MasterCvView";
import { MatchScoreView } from "@/components/MatchScoreView";
import { REVIEWED_DOCUMENTS, type CoachedApplication } from "@/human-coaches";
import { getHumanCoaches, requireHumanCoach } from "@/human-coaches/server";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ candidateId: string; applicationId: string }> };

/** The Application as the signed-in Human Coach may read it, or 404 without Coach Access. */
async function coachedApplication(params: Params["params"]) {
  const coach = await requireHumanCoach();
  const { candidateId: encoded, applicationId } = await params;
  const candidateId = decodeURIComponent(encoded);
  const coached = await getHumanCoaches().application(coach.id, candidateId, applicationId);
  if (!coached) notFound();
  return { coach, candidateId, applicationId, coached };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { coached } = await coachedApplication(params);
  const t = await getServerT();
  return { title: `${coached.application.jobOffer.title} · ${t("coachSpace.title")}`, robots: { index: false } };
}

async function sendReview(form: FormData) {
  "use server";
  const coach = await requireHumanCoach();
  const candidateId = String(form.get("candidateId"));
  const applicationId = String(form.get("applicationId"));
  const reviewed = await getHumanCoaches().review(coach.id, candidateId, applicationId, { document: form.get("document"), text: form.get("text") });
  const page = routes.coachSpaceApplication(candidateId, applicationId);
  if (!reviewed.ok && "error" in reviewed) redirect(routes.coachSpace); // Coach Access was revoked meanwhile.
  redirect(`${page}?review=${reviewed.ok ? "saved" : "invalid"}#review`);
}

/** Which Tailored Documents the Application has, so only those can be reviewed. */
function writtenDocuments(coached: CoachedApplication) {
  const written = { tailored_cv: coached.tailoredCv, cover_letter: coached.coverLetter, outreach_message: coached.outreachMessage };
  return REVIEWED_DOCUMENTS.filter((document) => written[document] !== null);
}

/** One Application of a coached Candidate, read only, with its Tailored Documents and the Human Coach's review form. */
export default async function CoachedApplicationPage({ params, searchParams }: Params & { searchParams: Promise<{ review?: string }> }) {
  const { candidateId, applicationId, coached } = await coachedApplication(params);
  const [t, locale, { review }] = await Promise.all([getServerT(), getRequestLocale(), searchParams]);
  const { application, tailoredCv, coverLetter, outreachMessage, reviews } = coached;
  const documents = writtenDocuments(coached);
  return (
    <main className="page">
      <CoachSpaceHeader />
      <p>
        <Link href={routes.coachSpaceCandidate(candidateId)}>{t("coachSpace.backToCandidate")}</Link>
      </p>
      <h1>{application.jobOffer.title}</h1>
      {application.jobOffer.employer ? <p className="lead">{application.jobOffer.employer}</p> : null}
      <p>{t("coachSpace.status", { status: t(`applicationStatuses.${application.status}`) })}</p>
      <p className="notice">{t("coachSpace.readOnly")}</p>

      <section className="stack" aria-labelledby="documents-title">
        <h2 id="documents-title">{t("coachSpace.documentsTitle")}</h2>
        <h3>{t("coachReviews.documents.tailored_cv")}</h3>
        {tailoredCv ? <MasterCvView cv={tailoredCv.content} t={t} /> : <p>{t("coachSpace.noDocument")}</p>}
        <h3>{t("coachReviews.documents.cover_letter")}</h3>
        {coverLetter ? <p className="cv-text">{coverLetter.text}</p> : <p>{t("coachSpace.noDocument")}</p>}
        <h3>{t("coachReviews.documents.outreach_message")}</h3>
        {outreachMessage ? (
          <>
            {outreachMessage.subject ? <p>{t("coachSpace.subject", { subject: outreachMessage.subject })}</p> : null}
            <p className="cv-text">{outreachMessage.text}</p>
          </>
        ) : (
          <p>{t("coachSpace.noDocument")}</p>
        )}
      </section>

      <CoachReviewList reviews={reviews} />

      <section className="stack" id="review" aria-labelledby="review-title">
        <h2 id="review-title">{t("coachSpace.reviewTitle")}</h2>
        {review === "saved" ? (
          <p className="notice" role="status">
            {t("coachSpace.reviewSaved")}
          </p>
        ) : null}
        {review === "invalid" ? (
          <p className="notice" role="alert">
            {t("coachSpace.reviewInvalid")}
          </p>
        ) : null}
        {documents.length === 0 ? (
          <p>{t("coachSpace.reviewNothing")}</p>
        ) : (
          <form className="stack" action={sendReview}>
            <input type="hidden" name="candidateId" value={candidateId} />
            <input type="hidden" name="applicationId" value={applicationId} />
            <label htmlFor="review-document">{t("coachSpace.reviewDocument")}</label>
            <select id="review-document" className="input" name="document" defaultValue={documents[0]}>
              {documents.map((document) => (
                <option key={document} value={document}>
                  {t(`coachReviews.documents.${document}`)}
                </option>
              ))}
            </select>
            <label htmlFor="review-text">{t("coachSpace.reviewText")}</label>
            <textarea id="review-text" className="input" name="text" rows={6} required />
            <button className="button button-primary" type="submit">
              {t("coachSpace.reviewSubmit")}
            </button>
          </form>
        )}
      </section>

      <MatchScoreView matchScore={application.matchScore} profileName={application.profile.name} t={t} locale={locale} />
      <JobOfferView jobOffer={application.jobOffer} t={t} locale={locale} />
    </main>
  );
}
