import type { Metadata } from "next";
import Link from "next/link";
import { CvExportForm } from "@/components/CvExportForm";
import { MasterCvView } from "@/components/MasterCvView";
import { TextSizeControl } from "@/components/TextSizeControl";
import { getRequestLocale, getServerT } from "@/i18n/server";
import { requireOwnProfile } from "@/profiles/server";
import { routes } from "@/routes";

type Params = { params: Promise<{ id: string }> };

async function currentProfile(id: string) {
  return (await requireOwnProfile(id)).profile;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const t = await getServerT();
  const profile = await currentProfile((await params).id);
  return { title: `${profile.name} · ${t("app.name")}` };
}

/** One Profile: its Search Criteria and the current version of its Master CV. */
export default async function ProfilePage({ params }: Params) {
  const profile = await currentProfile((await params).id);
  const t = await getServerT();
  const locale = await getRequestLocale();
  const { searchCriteria: criteria, masterCv } = profile;
  const notSpecified = t("profile.notSpecified");
  return (
    <main className="page">
      <header className="page-header">
        <Link className="brand" href={routes.home}>
          {t("app.name")}
        </Link>
        <TextSizeControl />
      </header>
      <h1>{profile.name}</h1>

      <h2>{t("cvReview.searchCriteria")}</h2>
      <dl>
        <dt>{t("cvReview.targetRole")}</dt>
        <dd>{criteria.targetRole}</dd>
        <dt>{t("cvReview.location")}</dt>
        <dd>{criteria.location}</dd>
        <dt>{t("cvReview.minSalary")}</dt>
        <dd>
          {criteria.minSalary === undefined
            ? notSpecified
            : t("profile.salary", { amount: new Intl.NumberFormat(locale).format(criteria.minSalary) })}
        </dd>
        <dt>{t("cvReview.contractType")}</dt>
        <dd>{criteria.contractType ? t(`cvReview.contractTypes.${criteria.contractType}`) : notSpecified}</dd>
        <dt>{t("cvReview.remoteWork")}</dt>
        <dd>{criteria.remoteWork ? t(`cvReview.remoteWorkOptions.${criteria.remoteWork}`) : notSpecified}</dd>
      </dl>

      <h2>{t("profile.masterCv")}</h2>
      <p>{t("profile.version", { version: masterCv.version })}</p>
      <MasterCvView cv={masterCv.content} t={t} />
      <nav className="actions" aria-label={t("profile.masterCv")}>
        <Link className="button button-primary" href={routes.editMasterCv(profile.id)}>
          {t("profile.editMasterCv")}
        </Link>
        <Link className="button" href={routes.masterCvVersions(profile.id)}>
          {t("profile.versionHistory")}
        </Link>
      </nav>

      <CvExportForm profileId={profile.id} t={t} />

      <p>
        <Link href={routes.account}>{t("profile.backToAccount")}</Link>
      </p>
    </main>
  );
}
