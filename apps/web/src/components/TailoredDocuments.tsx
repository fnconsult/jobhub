"use client";

import { DOCUMENT_LANGUAGES, type DocumentLanguage, type Provenance } from "@jobhub/shared";
import * as Tabs from "@radix-ui/react-tabs";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApplicationDrafts } from "@/tailored-documents";
import { OUTREACH_CHANNELS, TAILORED_DOCUMENTS, type OutreachChannel, type TailoredDocumentKind } from "@/tailored-documents/kinds";
import { mailLink } from "@/tailored-documents/mail-link";
import { buttonClass } from "@/design/button-class";
import { DocumentLayout, AsideBlock } from "@/design/DocumentLayout";
import { DocumentViewer } from "@/design/DocumentViewer";
import { Note } from "@/design/Note";
import { CV_TEMPLATES } from "@/export/kinds";
import { ApplicationExportForm } from "./ApplicationExportForm";
import { Icons } from "./icons";
import { LiveActionStatus, useLiveAction } from "./LiveAction";
import { ProvenanceLine } from "./ProvenanceLine";
import { TailoredCvReview, type TailoredCv } from "./TailoredCvReview";

type Status = "drafting" | "drafted" | "saved" | "copied" | "copyFailed" | "required" | "unavailable" | "notAContact" | "error" | null;

/** An Enriched Contact an Outreach Message can be addressed to. */
export interface Recipient {
  id: string;
  name: string;
  jobTitle?: string;
  email?: string;
}

/** What served a draft and when it was drafted (#334), for the line under it. */
type Served = { provenance?: Provenance | null; draftedAt?: string | Date };

/** Drafts as they come from the server. */
type Drafts = Pick<ApplicationDrafts, "documentLanguage"> & {
  coverLetter: ({ language: DocumentLanguage; text: string } & Served) | null;
  outreachMessage: ({ language: DocumentLanguage; text: string; subject: string; channel: OutreachChannel; contactRoles: string[]; contact: Recipient | null } & Served) | null;
};

/** What a failed request means for the Candidate. */
function statusOf(status: number, method: "POST" | "PATCH"): Status {
  if (status === 503) return "unavailable";
  if (status === 400) return "required";
  if (status === 404 && method === "POST") return "notAContact";
  return "error";
}

async function send(url: string, method: "POST" | "PATCH", body: object): Promise<{ drafts?: Drafts; status: Status }> {
  try {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { drafts: (await response.json()) as Drafts, status: null };
    return { status: statusOf(response.status, method) };
  } catch {
    return { status: "error" };
  }
}

const TAILORED_CV = "tailored_cv" as const;

const longDate = (date: string | Date, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(date));

/** The Job Offer the Tailored Documents are for. */
export type Target = { title: string; employer?: string };

/** The CV Template the Viewer and the aside's downloads use: the default one (the export form offers the others). */
const DEFAULT_TEMPLATE = CV_TEMPLATES[0];
const EXPORT_PATHS = { tailored_cv: "tailored-cv", cover_letter: "cover-letter" } as const;
const exportPath = (applicationId: string, document: keyof typeof EXPORT_PATHS) => `/api/applications/${applicationId}/${EXPORT_PATHS[document]}/export`;

/**
 * A Tailored Document's aside (#468): the Job Offer it is for (with the Tailored CV's Match Score), what to know about
 * it, and its downloads in PDF and Word once there is a file, with the day it was saved.
 */
function DocumentAside({
  target,
  matchScore = null,
  note,
  exportPath: path,
  savedOn = null,
}: {
  target: Target;
  matchScore?: number | null;
  note: string;
  exportPath: string | null;
  savedOn?: string | null;
}) {
  const { t } = useTranslation();
  const meta = [target.employer, matchScore === null ? null : t("tailoredDocuments.aside.matchScore", { score: matchScore })].filter(Boolean).join(" · ");
  return (
    <>
      <AsideBlock label={t("tailoredDocuments.aside.for")}>
        <p>
          <strong>{target.title}</strong>
        </p>
        {meta ? <p className="ds-document-layout__label">{meta}</p> : null}
      </AsideBlock>
      <Note tone="info">{note}</Note>
      {path ? (
        <AsideBlock>
          <a className={buttonClass({ variant: "primary" })} href={`${path}?format=pdf&template=${DEFAULT_TEMPLATE}`} download>
            <Icons.download />
            {t("tailoredDocuments.aside.downloadPdf")}
          </a>
          <a className={buttonClass()} href={`${path}?format=docx&template=${DEFAULT_TEMPLATE}`} download>
            <Icons.download />
            {t("tailoredDocuments.aside.downloadWord")}
          </a>
        </AsideBlock>
      ) : null}
      {savedOn ? <p className="ds-document-layout__label">{t("tailoredDocuments.aside.savedOn", { date: savedOn })}</p> : null}
    </>
  );
}
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
  target,
}: {
  applicationId: string;
  documentLanguage: DocumentLanguage;
  tailoredCv: TailoredCv | null;
  drafts: Drafts | null;
  recipients?: Recipient[];
  locale: string;
  /** The Job Offer the documents are tailored to, named in each tab's aside. */
  target: Target;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [language, setLanguage] = useState(documentLanguage);
  // What each tab's Viewer shows: the saved Tailored CV and the Cover Letter, drawn afresh once saved again.
  const [savedCv, setSavedCv] = useState(tailoredCv?.saved ?? null);
  const [letter, setLetter] = useState({ exists: Boolean(drafts?.coverLetter), version: 0 });
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
            <DocumentLayout
              asideLabel={t("tailoredDocuments.aside.label", { document: label.tailored_cv })}
              aside={
                <DocumentAside
                  target={target}
                  matchScore={savedCv?.matchScore.tailored ?? null}
                  note={t("tailoredDocuments.aside.cvNote")}
                  exportPath={savedCv ? exportPath(applicationId, TAILORED_CV) : null}
                  savedOn={savedCv ? longDate(savedCv.savedAt, locale) : null}
                />
              }
            >
              {savedCv ? (
                <DocumentViewer
                  key={String(savedCv.savedAt)}
                  src={`${exportPath(applicationId, TAILORED_CV)}?format=pdf&template=${DEFAULT_TEMPLATE}`}
                  fileName={t("tailoredDocuments.aside.cvFile", { title: target.title })}
                  aside={t("tailoredDocuments.aside.preview")}
                />
              ) : null}
              <TailoredCvReview applicationId={applicationId} initial={tailoredCv} language={language} locale={locale} onSaved={setSavedCv} />
            </DocumentLayout>
          </Tabs.Content>
        ) : null}
        {drafts ? (
          <>
            <Tabs.Content className="tabpanel" value={COVER_LETTER} forceMount>
              <DocumentLayout
                asideLabel={t("tailoredDocuments.aside.label", { document: label.cover_letter })}
                aside={<DocumentAside target={target} note={t("tailoredDocuments.draftsOnly")} exportPath={letter.exists ? exportPath(applicationId, COVER_LETTER) : null} />}
              >
                {letter.exists ? (
                  <DocumentViewer
                    key={letter.version}
                    src={`${exportPath(applicationId, COVER_LETTER)}?format=pdf&template=${DEFAULT_TEMPLATE}`}
                    fileName={t("tailoredDocuments.aside.letterFile", { title: target.title })}
                    aside={t("tailoredDocuments.aside.preview")}
                  />
                ) : null}
                <DraftEditor
                  applicationId={applicationId}
                  document={COVER_LETTER}
                  language={language}
                  initial={drafts.coverLetter}
                  onSaved={() => setLetter((current) => ({ exists: true, version: current.version + 1 }))}
                />
              </DocumentLayout>
            </Tabs.Content>
            <Tabs.Content className="tabpanel" value={OUTREACH_MESSAGE} forceMount>
              <DocumentLayout
                asideLabel={t("tailoredDocuments.aside.label", { document: label.outreach_message })}
                aside={<DocumentAside target={target} note={t("tailoredDocuments.draftsOnly")} exportPath={null} />}
              >
                <DraftEditor applicationId={applicationId} document={OUTREACH_MESSAGE} language={language} initial={drafts.outreachMessage} recipients={recipients} />
              </DocumentLayout>
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
  onSaved,
}: {
  applicationId: string;
  document: TailoredDocumentKind;
  language: DocumentLanguage;
  initial: Initial;
  recipients?: Recipient[];
  /** The draft was kept, drafted or edited: the page shows it afresh (#468). */
  onSaved?: () => void;
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
  // Drafting runs live, each step shown, and the Candidate can stop it (#334).
  const action = useLiveAction("tailored_documents");
  const isOutreach = document === "outreach_message";
  const drafted = draft && "channel" in draft ? draft : null;
  const contactRoles = drafted?.contactRoles ?? [];

  async function write() {
    setStatus("drafting");
    const outcome = await action.run<Drafts>(url, isOutreach ? { document, language, channel, ...(recipientId && { contactId: recipientId }) } : { document, language });
    // Stopped: nothing was kept, the draft shown stays; the stopped line says so.
    if ("stopped" in outcome) return setStatus(null);
    if (!outcome.ok) return setStatus(statusOf(outcome.status, "POST"));
    const next = outcome.body[document === "cover_letter" ? "coverLetter" : "outreachMessage"];
    if (!next) return setStatus("error");
    setDraft(next);
    setText(next.text);
    if ("subject" in next) setSubject(next.subject);
    setStatus("drafted");
    onSaved?.();
  }

  async function save() {
    setStatus(null);
    const result = await send(url, "PATCH", isOutreach ? { document, text, subject } : { document, text });
    setStatus(result.drafts ? "saved" : (result.status ?? "error"));
    if (result.drafts) onSaved?.();
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
          <LiveActionStatus action={action} />
        </>
      ) : (
        <>
          <p className="hint">{t(`tailoredDocuments.writtenIn.${draft.language}`)}</p>
          {draft.draftedAt ? <ProvenanceLine provenance={draft.provenance ?? null} at={new Date(draft.draftedAt).toISOString()} /> : null}
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
          <LiveActionStatus action={action} />
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
