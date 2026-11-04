"use client";

import { RECIPIENT_DATA_TEXT, TRANSFER_SAFEGUARD_TEXT, type ListedRecipient, type Translated } from "@jobhub/shared";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { writtenDay } from "@/public-pages/days";
import { CONTACT_ARTICLE, localePath } from "@/public-pages/public-shell";
import { routes } from "@/routes";
import { LegalLayout, type LegalPage } from "./LegalTextView";
import "./LegalTextView.css";

/** Légal's left column marks it as the page. */
const PAGE: LegalPage = "destinataires";

/** In the EU, outside it, or not established, which counts as outside (ADR-0064). */
const RESIDENCY_SHOWN = { eu: "eu", outside_eu: "outside_eu", unknown: "outside_eu" } as const;

/**
 * The Recipient list on Légal (ADR-0064, #338): « Destinataires des données », each recipient with what it is for, what
 * it is sent, the entity Jobbbox contracts with, where it processes the data (a residency not established is shown
 * outside the EU) and what a transfer rests on; and the day the list last changed (`changedOn`, a Paris day).
 */
export function RecipientListView({ recipients, changedOn }: { recipients: readonly ListedRecipient[]; changedOn: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "fr";
  const said = (text: string | Translated) => (typeof text === "string" ? text : text[locale]);
  return (
    <LegalLayout text={PAGE}>
      <h1 className="ds-legal__title">{t("recipientList.title")}</h1>
      <div className="ds-legal__stamp">
        {changedOn ? <span>{t("recipientList.changed", { date: writtenDay(changedOn, i18n.language) })}</span> : null}
        <Link href={localePath(routes.aiInJobbbox, locale)}>{t("recipientList.policy")}</Link>
      </div>
      <p className="ds-legal__intro">{t("recipientList.intro")}</p>
      <p className="ds-legal__intro">{t("recipientList.outsideEu")}</p>
      {/* GDPR art. 13(1)(f): the means to obtain a copy of the safeguards (Legal Review of #338). */}
      <p className="ds-legal__intro">
        {t("recipientList.copy")} <Link href={localePath(CONTACT_ARTICLE, locale)}>{t("recipientList.contact")}</Link>
      </p>
      {recipients.map((recipient) => (
        <section key={recipient.id} className="ds-recipient" aria-labelledby={`destinataire-${recipient.id}`}>
          <h2 id={`destinataire-${recipient.id}`}>
            {recipient.facts.name}
            <span className="ds-recipient__residency" data-residency={RESIDENCY_SHOWN[recipient.residency]}>
              {t(`recipientList.residency.${recipient.residency}`)}
            </span>
          </h2>
          <dl>
            <dt>{t("recipientList.purpose")}</dt>
            <dd>{said(recipient.facts.purpose)}</dd>
            <dt>{t("recipientList.data")}</dt>
            <dd>
              <ul>
                {recipient.facts.data.map((data) => (
                  <li key={data}>{RECIPIENT_DATA_TEXT[data][locale]}</li>
                ))}
              </ul>
            </dd>
            <dt>{t("recipientList.entity")}</dt>
            <dd>{said(recipient.facts.entity)}</dd>
            <dt>{t("recipientList.place")}</dt>
            <dd>{said(recipient.facts.place)}</dd>
            <dt>{t("recipientList.safeguard")}</dt>
            <dd>
              <ul>
                {recipient.facts.safeguards.map((safeguard) => (
                  <li key={safeguard}>{TRANSFER_SAFEGUARD_TEXT[safeguard][locale]}</li>
                ))}
              </ul>
            </dd>
          </dl>
        </section>
      ))}
    </LegalLayout>
  );
}
