"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UpgradePrompt as Prompt } from "@/billing/upgrade-prompt";
import type { ContactProviderId } from "@/enriched-contacts/providers/types";
import { UpgradePrompt, upgradePromptIn } from "./UpgradePrompt";

/** The Enriched Contacts state as it comes from the server (dates as strings once serialised). */
export interface EnrichedContactsData {
  enabled: boolean;
  searchable: boolean;
  found: { id: string; name: string; jobTitle?: string }[];
  contacts: { id: string; name: string; jobTitle?: string; emails: string[]; phones: string[]; source: { provider: ContactProviderId; retrievedAt: Date | string } }[];
}

type Failure = "unavailable" | "noDetails" | "searchUnsupported" | "needsDossier" | "error";

async function send(url: string): Promise<{ state?: EnrichedContactsData; failure?: Failure; prompt?: Prompt }> {
  try {
    const response = await fetch(url, { method: "POST" });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok) return { state: body as EnrichedContactsData };
    if (response.status === 402) {
      const prompt = upgradePromptIn(body);
      return prompt ? { prompt } : { failure: "error" };
    }
    const error = (body as { error?: string } | null)?.error;
    if (response.status === 503) return { failure: "unavailable" };
    if (error === "no_details") return { failure: "noDetails" };
    if (error === "search_unsupported") return { failure: "searchUnsupported" };
    if (error === "no_dossier") return { failure: "needsDossier" };
    return { failure: "error" };
  } catch {
    return { failure: "error" };
  }
}

/**
 * The Enriched Contacts of an Application (Premium): people found at the employer
 * by the Company Dossier's Suggested Contact Roles, whose contact details the
 * Candidate asks for one by one, each counted against the Plan Quota. Every
 * contact shows where and when its details were obtained.
 */
export function EnrichedContactsPanel({ applicationId, initial, hasDossier, locale }: { applicationId: string; initial: EnrichedContactsData; hasDossier: boolean; locale: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const id = useId();
  const [state, setState] = useState(initial);
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const url = `/api/applications/${applicationId}/enriched-contacts`;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Paris" });

  async function run(key: string, target: string) {
    setWorking(key);
    setFailure(null);
    setPrompt(null);
    const result = await send(target);
    setWorking(null);
    if (result.state) {
      setState(result.state);
      // The Outreach Message's recipients follow the Enriched Contacts.
      if (key !== "find") router.refresh();
    }
    setFailure(result.failure ?? null);
    setPrompt(result.prompt ?? null);
  }

  return (
    <section className="stack enriched-contacts" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("enrichedContacts.title")}</h2>
      <p>{t("enrichedContacts.intro")}</p>
      {!state.searchable ? (
        <p className="notice">{t("enrichedContacts.searchUnsupported")}</p>
      ) : !hasDossier ? (
        <p className="notice">{t("enrichedContacts.needsDossier")}</p>
      ) : (
        <button className="button button-primary" type="button" onClick={() => run("find", url)} disabled={working !== null}>
          {working === "find" ? t("enrichedContacts.working") : t(state.found.length || state.contacts.length ? "enrichedContacts.findAgain" : "enrichedContacts.find")}
        </button>
      )}
      {prompt ? <UpgradePrompt prompt={prompt} /> : null}
      {failure ? (
        <p className="field-error" role="alert">
          {t(`enrichedContacts.${failure}`)}
        </p>
      ) : null}

      {state.found.length > 0 ? (
        <div className="stack" role="group" aria-labelledby={`${id}-found`}>
          <h3 id={`${id}-found`}>{t("enrichedContacts.foundTitle")}</h3>
          <p id={`${id}-reveal-hint`} className="hint">
            {t("enrichedContacts.revealHint")}
          </p>
          <ul className="contact-list">
            {state.found.map((person) => (
              <li key={person.id} className="contact">
                <p>
                  <strong>{person.name}</strong>
                  {person.jobTitle ? ` · ${person.jobTitle}` : null}
                </p>
                <button
                  className="button"
                  type="button"
                  onClick={() => run(person.id, `${url}/${person.id}`)}
                  disabled={working !== null}
                  aria-label={t("enrichedContacts.revealFor", { name: person.name })}
                  aria-describedby={`${id}-reveal-hint`}
                >
                  {working === person.id ? t("enrichedContacts.revealing") : t("enrichedContacts.reveal")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.contacts.length > 0 ? (
        <div className="stack" role="group" aria-labelledby={`${id}-contacts`}>
          <h3 id={`${id}-contacts`}>{t("enrichedContacts.contactsTitle")}</h3>
          <p className="hint">{t("enrichedContacts.personalData")}</p>
          <ul className="contact-list">
            {state.contacts.map((contact) => (
              <li key={contact.id} className="contact">
                <p>
                  <strong>{contact.name}</strong>
                  {contact.jobTitle ? ` · ${contact.jobTitle}` : null}
                </p>
                <dl>
                  {contact.emails.map((email) => (
                    <div key={email}>
                      <dt>{t("enrichedContacts.email")}</dt>
                      <dd>
                        <a href={`mailto:${email}`}>{email}</a>
                      </dd>
                    </div>
                  ))}
                  {contact.phones.map((phone) => (
                    <div key={phone}>
                      <dt>{t("enrichedContacts.phone")}</dt>
                      <dd>
                        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="hint">
                  {t("enrichedContacts.source", {
                    provider: t(`enrichedContacts.providers.${contact.source.provider}`),
                    date: date.format(new Date(contact.source.retrievedAt)),
                  })}
                </p>
              </li>
            ))}
          </ul>
          <p className="hint">{t("enrichedContacts.useInOutreach")}</p>
        </div>
      ) : state.found.length === 0 ? (
        <p>{t("enrichedContacts.foundNone")}</p>
      ) : null}
    </section>
  );
}
