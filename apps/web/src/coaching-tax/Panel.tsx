import Link from "next/link";
import { getCurrentCandidate } from "@/auth/server";
import { sharedPool } from "@/database/pool";
import { buttonClass } from "@/design/button-class";
import { Card } from "@/design/Card";
import { Field, Select } from "@/design/Field";
import { getServerT } from "@/i18n/server";
import { getCoachingTaxes } from "./server";
import { taxLegalReady } from "./legal";
import { TaxIdentityForm } from "./IdentityForm";
export async function TaxPanel({ sellerId, year: askedYear }: { sellerId: string | null; year?: number }) {
  const t = await getServerT(),
    person = await getCurrentCandidate();
  if (!sellerId || !person) return null;
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric" }).format(new Date()));
  const year = Number.isInteger(askedYear) && askedYear! >= 2026 && askedYear! <= currentYear ? askedYear! : currentYear;
  const seller = (await sharedPool().query<{ siret: string; kind: string }>("SELECT siret,kind FROM coaching_seller WHERE id=$1", [sellerId])).rows[0];
  if (!seller) return null;
  const taxes = getCoachingTaxes(),
    identity = await taxes.identity(person.id, sellerId, year),
    reports = await taxes.reportsFor(person.id, sellerId);
  return (
    <Card title={t("coachTax.title")}>
      <div className="stack">
        <p>{t("coachTax.basis")}</p>
        <p>{t("coachTax.supportedScope")}</p>
        <form method="get" className="stack">
          <Field label={t("coachTax.year")}>
            <Select name="fiscalYear" defaultValue={year}>
              {Array.from({ length: Math.max(0, currentYear - 2025) }, (_, i) => 2026 + i).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <button className={buttonClass()} type="submit">
            {t("coachTax.showYear")}
          </button>
        </form>
        {taxLegalReady() ? (
          <TaxIdentityForm
            sellerId={sellerId}
            year={year}
            initial={identity?.identity ?? null}
            siret={seller.siret}
            association={seller.kind === "association"}
          />
        ) : (
          <p>{t("coachTax.legalPending")}</p>
        )}
        {reports.map((report) => (
          <p key={report.id}>
            <Link href={`/api/account/coaching/tax/${report.id}/${sellerId}`}>{t("coachTax.copyTitle", { year: report.year })}</Link>
          </p>
        ))}
      </div>
    </Card>
  );
}
