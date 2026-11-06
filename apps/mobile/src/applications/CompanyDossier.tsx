import type { CompanyDossierRead } from "@jobhub/shared/reads";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useCompanyDossier } from "../api/reads";
import { ReadState } from "../screens/ReadState";
import { radius, space, useTheme } from "../theme/theme";
import { AppText } from "../ui/AppText";
import { TextLink } from "../ui/TextLink";
import { applicationFormats, type ApplicationFormats } from "./application-formats";
import { Property } from "./Property";

/**
 * The Application's « Dossier entreprise » Section (#691), as the web's (CompanyDossierView), to read: how reliable it
 * is, the employer's identity, address and figures, the roles of its executives, the roles to contact, its Company News
 * and the pages its facts come from. No person is named. Building it, naming or confirming the employer and updating it
 * are done on jobbbox.ai (ADR-0076): before it is built, the Section says so.
 */
export function CompanyDossier({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation();
  return (
    <ReadState read={useCompanyDossier(applicationId)} notFound={t("mobile.applications.notFound")}>
      {(state) => (
        <View style={{ gap: space[3] }}>
          <AppText variant="h3" heading>
            {t("companyDossier.title")}
          </AppText>
          {state.status === "built" ? (
            <Dossier dossier={state.dossier} />
          ) : state.status === "awaiting_confirmation" ? (
            <>
              <AppText>
                {[
                  state.agency ? t("companyDossier.postedByAgency", { agency: state.agency }) : t("companyDossier.postedByAgencyUnnamed"),
                  state.presumedEmployer
                    ? t("companyDossier.presumedEmployer", { employer: state.presumedEmployer })
                    : state.presumedEmployerDescription
                      ? t("companyDossier.presumedEmployerDescribed", { description: state.presumedEmployerDescription })
                      : t("companyDossier.noPresumedEmployer"),
                ].join(" ")}
              </AppText>
              <AppText tone="secondary">{t("mobile.applications.dossierConfirmOnWeb")}</AppText>
            </>
          ) : state.status === "employer_unknown" ? (
            <AppText tone="secondary">{t("mobile.applications.dossierEmployerOnWeb")}</AppText>
          ) : (
            <>
              <AppText>{t("companyDossier.intro")}</AppText>
              <AppText tone="secondary">{t("mobile.applications.dossierNotBuilt")}</AppText>
            </>
          )}
        </View>
      )}
    </ReadState>
  );
}

/** The facts the dossier holds, each under its label, in the web's order. */
function factsOf(dossier: CompanyDossierRead, t: TFunction, formats: ApplicationFormats): [string, string][] {
  const facts: [string, string | null][] =
    dossier.source === "french_register"
      ? [
          [t("companyDossier.facts.name"), dossier.name],
          [t("companyDossier.facts.siren"), dossier.siren],
          [t("companyDossier.facts.legalForm"), dossier.legalForm],
          [t("companyDossier.facts.activity"), dossier.activity],
          [t("companyDossier.facts.address"), dossier.address],
          [
            t("companyDossier.facts.headcount"),
            dossier.headcount === null
              ? null
              : dossier.headcount.max === null
                ? t("companyDossier.headcountFrom", { min: formats.number(dossier.headcount.min) })
                : t("companyDossier.headcountRange", { min: formats.number(dossier.headcount.min), max: formats.number(dossier.headcount.max) }),
          ],
        ]
      : [
          [t("companyDossier.facts.name"), dossier.employer],
          [t("companyDossier.facts.country"), dossier.country],
          [t("companyDossier.facts.address"), dossier.address],
          [t("companyDossier.facts.industry"), dossier.industry],
          [t("companyDossier.facts.headcount"), dossier.headcount],
          [t("companyDossier.facts.revenue"), dossier.revenue],
        ];
  return facts.filter((fact): fact is [string, string] => fact[1] !== null);
}

function Dossier({ dossier }: { dossier: CompanyDossierRead }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const formats = applicationFormats(i18n.language);
  const amount = (euros: number | null) => (euros === null ? "—" : formats.money(euros));
  return (
    <>
      <View role="note" style={{ gap: space[1], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: dossier.reliability === "official" ? colors.border : colors.warn }}>
        <AppText weight="semiBold">{t(`companyDossier.reliability.${dossier.reliability}`)}</AppText>
        <AppText>{t(`companyDossier.reliabilityDetail.${dossier.reliability}`)}</AppText>
      </View>
      {factsOf(dossier, t, formats).map(([label, value]) => (
        <Property key={label} label={label}>
          <AppText>{value}</AppText>
        </Property>
      ))}
      {dossier.source === "web" && dossier.website ? (
        <Property label={t("companyDossier.facts.website")}>
          <TextLink label={dossier.website} url={dossier.website} />
        </Property>
      ) : null}

      {dossier.source === "french_register" ? (
        <>
          <Heading>{t("companyDossier.financialsTitle")}</Heading>
          {dossier.financials.length > 0 ? (
            dossier.financials.map((year) => (
              <AppText key={year.year}>{t("mobile.applications.financialYear", { year: year.year, revenue: amount(year.revenue), netIncome: amount(year.netIncome) })}</AppText>
            ))
          ) : (
            <AppText>{t("companyDossier.noFinancials")}</AppText>
          )}
          {dossier.executiveRoles.length > 0 ? (
            <>
              <Heading>{t("companyDossier.executivesTitle")}</Heading>
              <AppText tone="secondary">{t("companyDossier.executivesHint")}</AppText>
              {dossier.executiveRoles.map((role) => (
                <AppText key={role}>{role}</AppText>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      <Heading>{t("companyDossier.contactRolesTitle")}</Heading>
      <AppText tone="secondary">{t("companyDossier.contactRolesHint")}</AppText>
      {dossier.suggestedContactRoles.map((role) => (
        <AppText key={role}>{t(`companyDossier.contactRoles.${role}`)}</AppText>
      ))}

      {/* Company News: each article's title, outlet and date, linking to it; never its text. */}
      <Heading>{t("companyDossier.newsTitle")}</Heading>
      {!dossier.newsSearched ? (
        <AppText>{t("companyDossier.newsNotSearched")}</AppText>
      ) : dossier.news.length > 0 ? (
        dossier.news.map((article) => (
          <View key={article.url}>
            <TextLink label={article.title} url={article.url} />
            <AppText variant="meta" tone="meta">
              {t("companyDossier.newsMeta", { outlet: article.outlet, date: formats.day(article.publishedAt) })}
            </AppText>
          </View>
        ))
      ) : (
        <AppText>{t("companyDossier.noNews")}</AppText>
      )}
      {dossier.newsSearched ? (
        <AppText variant="meta" tone="meta">
          {t("companyDossier.newsSearchedOn", { date: formats.date(dossier.builtAt) })}
        </AppText>
      ) : null}

      {dossier.source === "web" && dossier.sources.length > 0 ? (
        <>
          <Heading>{t("companyDossier.sourcesTitle")}</Heading>
          {dossier.sources.map((source) => (
            <TextLink key={source} label={source} url={source} />
          ))}
        </>
      ) : null}

      <AppText tone="secondary">{t("companyDossier.builtOn", { date: formats.date(dossier.builtAt), employer: dossier.employer })}</AppText>
      <AppText tone="secondary">{t("mobile.applications.dossierUpdateOnWeb")}</AppText>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <AppText weight="semiBold" heading>
      {children}
    </AppText>
  );
}
