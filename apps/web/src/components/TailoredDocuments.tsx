"use client";

import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "@jobhub/shared";
import * as Tabs from "@radix-ui/react-tabs";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDrafts } from "@/tailored-documents";
import { OUTREACH_CHANNELS, TAILORED_DOCUMENTS, type OutreachChannel, type TailoredDocumentKind } from "@/tailored-documents/kinds";
import { mailLink } from "@/tailored-documents/mail-link";
import { ApplicationExportForm } from "./ApplicationExportForm";
import { TailoredCvReview, type TailoredCv } from "./TailoredCvReview";

type Status = "drafting" | "drafted" | "saved" | "copied" | "copyFailed" | "required" | "unavailable" | "notAContact" | "error" | null;

/** An Enriched Contact an Outreach Message can be addressed to. */
export interface Recipient {
  id: string;
  name: string;
  jobTitle?: string;
  email?: string;
}

/** Drafts as they come from the server: dates are not needed here. */
type Drafts = Pick<ApplicationDrafts, "documentLanguage"> & {
  coverLetter: { language: DocumentLanguage; text: string } | null;
  outreachMessage: { language: DocumentLanguage; text: string; subject: string; channel: OutreachChannel; contactRoles: string[]; contact: Recipient | null } | null;
};

async function send(url: string, method: "POST" | "PATCH", body: object): Promise<{ drafts?: Drafts; status: Status }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { drafts: (await response.json()) as Drafts, status: null };
    if (response.status === 503) return { status: "unavailable" };
    if (response.status === 400) return { status: "required" };
    if (response.status === 404 && method === "POST") return { status: "notAContact" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

const TAILORED_CV = "tailored_cv" as const;
const [COVER_LETTER, OUTREACH_MESSAGE] = TAILORED_DOCUMENTS;
type Tab = typeof TAILORED_CV | TailoredDocumentKind;

/**
 * An Application's Tailored Documents, one tab each: the Tailored CV (see
 * TailoredCvReview), the Cover Letter and the Outreach Message. All are written
 * in the Document Language, chosen once above the tabs for all three. The
 * Cover Letter and Outreach Message are drafted by the AI Coach, edited by the
 * Candidate, drafted again on request. Drafts only (ADR-0005): the Candidate
 * copies the text or opens it in their mail client. The Outreach Message can be
 * addressed to one of the Application's Enriched Contacts (`recipients`).
 * Every tab stays mounted, so switching tabs keeps unsaved edits.
 */
export function TailoredDocuments({
  applicationId,
  documentLanguage,
  tailoredCv,
  drafts,
  recipients = [],
  locale,
}: {
  applicationId: string;
  documentLanguage: DocumentLanguage;
  tailoredCv: TailoredCv | null;
  drafts: Drafts | null;
  recipients?: Recipient[];
  locale: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [language, setLanguage] = useState(documentLanguage);
  const tabs: Tab[] = [...(tailoredCv ? [TAILORED_CV] : []), ...(drafts ? TAILORED_DOCUMENTS : [])];
  const [tab, setTab] = useState<string>(tabs[0] ?? TAILORED_CV);
  const label = { tailored_cv: t("tailoredCv.tailored"), cover_letter: t("tailoredDocuments.coverLetter.title"), outreach_message: t("tailoredDocuments.outreachMessage.title") };
  return (
    <section className="section" aria-labelledby={`${id}-title`}>
      <div className="section-head">
        <h2 id={`${id}-title`}>{t("application.documentsTitle")}</h2>
      </div>
      <div className="field">
        <label htmlFor={`${id}-language`}>{t("tailoredDocuments.languageLabel")}</label>
        <p id={`${id}-language-hint`} className="hint">
          {t("tailoredDocuments.languageHint")}
        </p>
        <select
          id={`${id}-language`}
          className="input"
          value={language}
          aria-describedby={`${id}-language-hint`}
          onChange={(event) => setLanguage(event.target.value as DocumentLanguage)}
        >
          {DOCUMENT_LANGUAGES.map((option) => (
            <option key={option} value={option}>
              {t(`tailoredDocuments.languages.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List className="tablist" aria-label={t("application.documentsTitle")}>
          {tabs.map((value) => (
            <Tabs.Trigger key={value} className="tab" value={value}>
              {label[value]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {tailoredCv ? (
          <Tabs.Content className="tabpanel" value={TAILORED_CV} forceMount>
            <TailoredCvReview applicationId={applicationId} initial={tailoredCv} language={language} locale={locale} />
          </Tabs.Content>
        ) : null}
        {drafts ? (
          <>
            <Tabs.Content className="tabpanel" value={COVER_LETTER} forceMount>
              <p className="notice">{t("tailoredDocuments.draftsOnly")}</p>
              <DraftEditor applicationId={applicationId} document={COVER_LETTER} language={language} initial={drafts.coverLetter} />
            </Tabs.Content>
            <Tabs.Content className="tabpanel" value={OUTREACH_MESSAGE} forceMount>
              <p className="notice">{t("tailoredDocuments.draftsOnly")}</p>
              <DraftEditor applicationId={applicationId} document={OUTREACH_MESSAGE} language={language} initial={drafts.outreachMessage} recipients={recipients} />
            </Tabs.Content>
          </>
        ) : null}
      </Tabs.Root>
    </section>
  );
}

type Initial = Drafts["coverLetter"] | Drafts["outreachMessage"];

function DraftEditor({
  applicationId,
  document,
  language,
  initial,
  recipients = [],
}: {
  applicationId: string;
  document: TailoredDocumentKind;
  language: DocumentLanguage;
  initial: Initial;
  recipients?: Recipient[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const url = `/api/applications/${applicationId}/tailored-documents`;
  const keys = document === "cover_letter" ? "tailoredDocuments.coverLetter" : "tailoredDocuments.outreachMessage";
  const outreach = initial && "channel" in initial ? initial : null;
  const [draft, setDraft] = useState(initial);
  const [text, setText] = useState(initial?.text ?? "");
  const [subject, setSubject] = useState(outreach?.subject ?? "");
  const [channel, setChannel] = useState<OutreachChannel>(outreach?.channel ?? "email");
  const [recipientId, setRecipientId] = useState(outreach?.contact && recipients.some((r) => r.id === outreach.contact?.id) ? outreach.contact.id : "");
  const [status, setStatus] = useState<Status>(null);
  const isOutreach = document === "outreach_message";
  const drafted = draft && "channel" in draft ? draft : null;
  const contactRoles = drafted?.contactRoles ?? [];

  async function write() {
    setStatus("drafting");
    const result = await send(url, "POST", isOutreach ? { document, language, channel, ...(recipientId && { contactId: recipientId }) } : { document, language });
    const next = result.drafts?.[document === "cover_letter" ? "coverLetter" : "outreachMessage"];
    if (!next) return setStatus(result.status ?? "error");
    setDraft(next);
    setText(next.text);
    if ("subject" in next) setSubject(next.subject);
    setStatus("drafted");
  }

  async function save() {
    setStatus(null);
    const result = await send(url, "PATCH", isOutreach ? { document, text, subject } : { document, text });
    setStatus(result.drafts ? "saved" : (result.status ?? "error"));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("copyFailed");
    }
  }

  const channelSelect = isOutreach ? (
    <>
      {recipients.length > 0 ? (
        <div className="field">
          <label htmlFor={`${id}-recipient`}>{t("tailoredDocuments.outreachMessage.recipientLabel")}</label>
          <select id={`${id}-recipient`} className="input" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
            <option value="">{t("tailoredDocuments.outreachMessage.recipientNone")}</option>
            {recipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.jobTitle ? `${recipient.name} · ${recipient.jobTitle}` : recipient.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor={`${id}-channel`}>{t("tailoredDocuments.outreachMessage.channelLabel")}</label>
        <select id={`${id}-channel`} className="input" value={channel} onChange={(event) => setChannel(event.target.value as OutreachChannel)}>
          {OUTREACH_CHANNELS.map((option) => (
            <option key={option} value={option}>
              {t(`tailoredDocuments.outreachMessage.channels.${option}`)}
            </option>
          ))}
        </select>
      </div>
    </>
  ) : null;

  return (
    <div className="stack">
      {draft === null ? (
        <>
          <p>{t(`${keys}.none`)}</p>
          {channelSelect}
          <button className="button button-primary" type="button" onClick={write} disabled={status === "drafting"}>
            {status === "drafting" ? t("tailoredDocuments.drafting") : t(`${keys}.draft`)}
          </button>
        </>
      ) : (
        <>
          <p className="hint">{t(`tailoredDocuments.writtenIn.${draft.language}`)}</p>
          {drafted?.contact ? (
            <p>{t("tailoredDocuments.outreachMessage.addressedTo", { name: drafted.contact.jobTitle ? `${drafted.contact.name} (${drafted.contact.jobTitle})` : drafted.contact.name })}</p>
          ) : null}
          {contactRoles.length > 0 && !drafted?.contact ? (
            <div>
              <p className="hint">{t("tailoredDocuments.outreachMessage.contactRoles")}</p>
              <ul>
                {contactRoles.map((role) => (
                  <li key={role}>{role}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {isOutreach ? (
            <div className="field">
              <label htmlFor={`${id}-subject`}>{t("tailoredDocuments.outreachMessage.subjectLabel")}</label>
              <input id={`${id}-subject`} className="input" maxLength={300} value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor={`${id}-text`}>{t(`${keys}.textLabel`)}</label>
            <textarea
              id={`${id}-text`}
              className="input"
              rows={isOutreach ? 8 : 16}
              maxLength={10_000}
              value={text}
              aria-invalid={status === "required" ? true : undefined}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="actions">
            <button className="button button-primary" type="button" onClick={save}>
              {t("tailoredDocuments.save")}
            </button>
            <button className="button" type="button" onClick={copy}>
              {t("tailoredDocuments.copy")}
            </button>
            {drafted?.channel === "email" ? (
              <a className="button" href={mailLink({ to: drafted.contact?.email, subject, text })}>
                {t("tailoredDocuments.outreachMessage.openInMail")}
              </a>
            ) : null}
          </div>
          {document === "cover_letter" ? <ApplicationExportForm applicationId={applicationId} document={document} /> : null}
          {channelSelect}
          <p id={`${id}-redraft-hint`} className="hint">
            {t("tailoredDocuments.redraftHint")}
          </p>
          <button className="button" type="button" onClick={write} disabled={status === "drafting"} aria-describedby={`${id}-redraft-hint`}>
            {status === "drafting" ? t("tailoredDocuments.drafting") : t("tailoredDocuments.redraft")}
          </button>
        </>
      )}
      <StatusMessage status={status} />
    </div>
  );
}

function StatusMessage({ status }: { status: Status }) {
  const { t } = useTranslation();
  if (status === "drafted" || status === "saved" || status === "copied") return <p role="status">{t(`tailoredDocuments.${status}`)}</p>;
  if (status === "notAContact")
    return (
      <p className="field-error" role="alert">
        {t("tailoredDocuments.outreachMessage.notAContact")}
      </p>
    );
  if (status === "required" || status === "unavailable" || status === "error" || status === "copyFailed")
    return (
      <p className="field-error" role="alert">
        {t(`tailoredDocuments.${status}`)}
      </p>
    );
  return null;
}
