"use client";

import { DOCUMENT_LANGUAGES, type DocumentLanguage } from "@jobhub/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDrafts } from "@/tailored-documents";
import { OUTREACH_CHANNELS, TAILORED_DOCUMENTS, type OutreachChannel, type TailoredDocumentKind } from "@/tailored-documents/kinds";
import { mailLink } from "@/tailored-documents/mail-link";

type Status = "drafting" | "drafted" | "saved" | "copied" | "copyFailed" | "required" | "unavailable" | "error" | null;

/** Drafts as they come from the server: dates are not needed here. */
type Drafts = Pick<ApplicationDrafts, "documentLanguage"> & {
  coverLetter: { language: DocumentLanguage; text: string } | null;
  outreachMessage: { language: DocumentLanguage; text: string; subject: string; channel: OutreachChannel; contactRoles: string[] } | null;
};

async function send(url: string, method: "POST" | "PATCH", body: object): Promise<{ drafts?: Drafts; status: Status }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { drafts: (await response.json()) as Drafts, status: null };
    if (response.status === 503) return { status: "unavailable" };
    if (response.status === 400) return { status: "required" };
    return { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/**
 * An Application's Cover Letter and Outreach Message: drafted by the AI Coach in
 * the Document Language, edited by the Candidate, drafted again on request.
 * Drafts only (ADR-0005): the Candidate copies the text or opens it in their mail client.
 */
export function TailoredDocumentsEditor({ applicationId, initial }: { applicationId: string; initial: Drafts }) {
  const { t } = useTranslation();
  const id = useId();
  const [language, setLanguage] = useState(initial.documentLanguage);
  return (
    <section className="stack tailored-documents" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("tailoredDocuments.title")}</h2>
      <p className="notice">{t("tailoredDocuments.draftsOnly")}</p>
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
      <DraftEditor applicationId={applicationId} document={TAILORED_DOCUMENTS[0]} language={language} initial={initial.coverLetter} />
      <DraftEditor applicationId={applicationId} document={TAILORED_DOCUMENTS[1]} language={language} initial={initial.outreachMessage} />
    </section>
  );
}

type Initial = Drafts["coverLetter"] | Drafts["outreachMessage"];

function DraftEditor({ applicationId, document, language, initial }: { applicationId: string; document: TailoredDocumentKind; language: DocumentLanguage; initial: Initial }) {
  const { t } = useTranslation();
  const id = useId();
  const url = `/api/applications/${applicationId}/tailored-documents`;
  const keys = document === "cover_letter" ? "tailoredDocuments.coverLetter" : "tailoredDocuments.outreachMessage";
  const outreach = initial && "channel" in initial ? initial : null;
  const [draft, setDraft] = useState(initial);
  const [text, setText] = useState(initial?.text ?? "");
  const [subject, setSubject] = useState(outreach?.subject ?? "");
  const [channel, setChannel] = useState<OutreachChannel>(outreach?.channel ?? "email");
  const [status, setStatus] = useState<Status>(null);
  const isOutreach = document === "outreach_message";
  const drafted = draft && "channel" in draft ? draft : null;
  const contactRoles = drafted?.contactRoles ?? [];

  async function write() {
    setStatus("drafting");
    const result = await send(url, "POST", isOutreach ? { document, language, channel } : { document, language });
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
  ) : null;

  return (
    <div className="stack" role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t(`${keys}.title`)}</h3>
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
          <p className="hint">{t("tailoredDocuments.writtenIn", { language: t(`tailoredDocuments.languages.${draft.language}`) })}</p>
          {contactRoles.length > 0 ? (
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
              className="input draft-text"
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
              <a className="button" href={mailLink({ subject, text })}>
                {t("tailoredDocuments.outreachMessage.openInMail")}
              </a>
            ) : null}
          </div>
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
  if (status === "required" || status === "unavailable" || status === "error" || status === "copyFailed")
    return (
      <p className="field-error" role="alert">
        {t(`tailoredDocuments.${status}`)}
      </p>
    );
  return null;
}
